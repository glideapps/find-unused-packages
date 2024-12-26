import fs from "fs";
import { separateStringByMatches } from "./support";

export interface Import {
    readonly kind: "import" | "export";
    readonly isType: boolean;
    // `true` means a wildcard import
    readonly names: readonly string[] | true;
    readonly path: string;
}

export type Part = string | Import;
type Parts = readonly Part[];

const importRegexp =
    /(import|export)(\s+type)?\s+(\*|{([^}]*?)}|[a-zA-Z_$][a-zA-Z\d_$]*)\s+from "([^";]+)";/g;

export function parseImports(code: string): Parts {
    const parsedParts = separateStringByMatches(importRegexp, code);
    const parts: Part[] = [];

    for (const p of parsedParts) {
        if (typeof p === "string") {
            parts.push(p);
        } else {
            const kind = p[1] as "import" | "export";
            const type = p[2] !== undefined;
            const path = p[5];
            if (p[3] === "*") {
                parts.push({ kind, isType: type, names: true, path });
            } else if (p[4]) {
                const names = p[4]
                    .split(",")
                    .map((n) => n.trim())
                    .filter((n) => n.length > 0);
                parts.push({ kind, isType: type, names, path });
            } else {
                parts.push(p[0]);
            }
        }
    }

    return parts;
}

export function readFileAndParseImports(filePath: string): Parts {
    const content = fs.readFileSync(filePath, "utf8");
    return parseImports(content);
}

export function unparseImports(parts: Parts): string {
    return parts
        .map((p) => {
            if (typeof p === "string") {
                return p;
            } else {
                const type = p.isType ? "type " : "";
                if (p.names === true) {
                    return `${p.kind} ${type}* from "${p.path}";`;
                } else {
                    const names = p.names.join(", ");
                    return `${p.kind} ${type}{ ${names} } from "${p.path}";`;
                }
            }
        })
        .join("");
}

export function unparseImportsAndWriteFile(
    parts: Parts,
    filePath: string
): void {
    const content = unparseImports(parts);
    fs.writeFileSync(filePath, content, "utf8");
}
