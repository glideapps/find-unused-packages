import fs from "fs";
import path from "path";
import { assert } from "@glideapps/ts-necessities";
import { isTSFile, walkDirectory } from "./support";
import {
    getWildcardImport,
    isTypeImport,
    readFileAndParseImports,
    unparseImportsAndWriteFile,
    type Import,
    type ImportName,
    type Part,
} from "./parse-imports";
import { parseGlideImportPath } from "./glide";

// from -> to
const dontRewrite: Record<string, Record<string, true>> = {
    "@glide/plugins": {
        "@glide/plugins-codecs": true,
    },
};

// Returns `undefined` if the file shouldn't be followed
function findTSFile(filePath: string) {
    if (filePath.endsWith(".js")) return undefined;

    const tsFilename = filePath + ".ts";
    if (fs.existsSync(tsFilename)) {
        return tsFilename;
    }

    const tsxFilename = filePath + ".tsx";
    if (fs.existsSync(tsxFilename)) {
        return tsxFilename;
    }

    const indexTSFilename = path.join(filePath, "index.ts");
    if (fs.existsSync(indexTSFilename)) {
        return indexTSFilename;
    }

    const indexTSXFilename = path.join(filePath, "index.tsx");
    if (fs.existsSync(indexTSXFilename)) {
        return indexTSXFilename;
    }

    const jsFilename = filePath + ".js";
    if (fs.existsSync(jsFilename)) return undefined;

    const indexDTSFilename = path.join(filePath, "index.d.ts");
    if (fs.existsSync(indexDTSFilename)) return undefined;

    console.error("Not found:", filePath);
    process.exit(1);
}

async function resolveImports(packageDir: string, filePath: string) {
    function findImportedFile(
        packageName: string,
        subpath: string | undefined
    ) {
        let filePath = path.join(packageDir, packageName, "src");
        if (subpath !== undefined) {
            filePath = path.join(filePath, subpath);
        } else {
            filePath = path.join(filePath, "index");
        }

        return findTSFile(filePath);
    }

    function resolveImport(name: string, importedFromPath: string) {
        if (name === "asString" && filePath.endsWith("primitives.ts")) {
            debugger;
        }

        let currentFilePath = filePath;
        // If this is set, it's either a path to an NPM package, or the
        // absolute path to a TypeScript file.
        let lastSuccessfulPath: string | undefined;

        function resolveLastSucessfulPath() {
            const stripSuffixes = [/(^|\/)index\.tsx?$/, /\.tsx?$/];

            if (lastSuccessfulPath === undefined) return undefined;
            if (!lastSuccessfulPath.startsWith("/")) return lastSuccessfulPath;

            let relative = path.relative(
                path.parse(filePath).dir,
                lastSuccessfulPath
            );

            for (const suffix of stripSuffixes) {
                const match = relative.match(suffix);
                if (match !== null) {
                    relative = relative.substring(0, match.index);
                    break;
                }
            }

            if (relative.startsWith(".")) {
                return relative;
            } else if (relative === "") {
                return ".";
            } else {
                return "./" + relative;
            }
        }

        again: for (;;) {
            let nextFilePath: string | undefined;

            if (importedFromPath.startsWith(".")) {
                const { dir } = path.parse(currentFilePath);
                nextFilePath = findTSFile(path.join(dir, importedFromPath));

                if (
                    lastSuccessfulPath === undefined ||
                    lastSuccessfulPath.startsWith("/")
                ) {
                    lastSuccessfulPath = nextFilePath;
                }
            } else {
                const glideImportPath = parseGlideImportPath(importedFromPath);
                if (glideImportPath === undefined)
                    return resolveLastSucessfulPath();
                const { packageName, subpath } = glideImportPath;

                nextFilePath = findImportedFile(packageName, subpath);

                lastSuccessfulPath = importedFromPath;
            }
            if (nextFilePath === undefined) return resolveLastSucessfulPath();

            const parts = readFileAndParseImports(nextFilePath);
            for (const part of parts) {
                if (typeof part === "string") continue;
                // FIXME: handle wildcard imports by recursing
                if (getWildcardImport(part) !== undefined) continue;

                if (part.names.some((n) => n.name === name)) {
                    importedFromPath = part.path;
                    currentFilePath = nextFilePath;
                    continue again;
                }
            }

            return resolveLastSucessfulPath();
        }
    }

    assert(isTSFile(filePath));

    const parts = readFileAndParseImports(filePath);

    let didRewrite = false;
    const resultParts: Part[] = [];

    for (const part of parts) {
        if (typeof part === "string" || getWildcardImport(part) !== undefined) {
            resultParts.push(part);
            continue;
        }

        const namesToKeep: ImportName[] = [];
        const newImports: (Import & { names: ImportName[] })[] = [];
        for (const name of part.names) {
            assert(name.name !== true);
            const resolved = resolveImport(name.name, part.path);
            if (
                resolved === undefined ||
                resolved === part.path ||
                dontRewrite[part.path]?.[resolved] === true
            ) {
                namesToKeep.push(name);
                continue;
            }

            // console.log(`${name}: ${part.path} -> ${resolved}`);
            let newImport: (Import & { names: ImportName[] }) | undefined;
            for (const i of newImports) {
                if (i.path === resolved) {
                    newImport = i;
                    break;
                }
            }
            if (newImport === undefined) {
                newImport = {
                    kind: part.kind,
                    names: [],
                    path: resolved,
                };
                newImports.push(newImport);
            }
            newImport.names.push(name);

            didRewrite = true;
        }
        for (const newImport of newImports) {
            resultParts.push(newImport, "\n");
        }
        if (namesToKeep.length > 0) {
            resultParts.push({ ...part, names: namesToKeep });
        }
    }

    if (didRewrite) {
        console.log("Resolved imports in", filePath);
        await unparseImportsAndWriteFile(resultParts, filePath, false);
    }
}

export async function resolveImportsInDirectories(
    packageDir: string,
    sourcePaths: readonly string[]
): Promise<void> {
    for (const sourcePath of sourcePaths) {
        await walkDirectory(sourcePath, async (filePath) => {
            if (!isTSFile(filePath)) return;
            await resolveImports(packageDir, filePath);
        });
    }
}
