import fs from "fs";
import path from "path";
import { $, Glob } from "bun";
import { readFileAndParseImports } from "./parse-imports";

export async function countDependencyImports(dir: string) {
    if (!dir) {
        console.error("Please provide a directory path as argument.");
        process.exit(1);
    }

    // read the deps.json from dir.
    // if it doesn't exist, create it.
    if (!fs.existsSync(path.join(dir, "deps.json"))) {
        console.log(
            "deps.json not found in the current directory, creating it with nx"
        );
        await $`cd ${path.join(dir)} && npx nx graph --file=deps.json`;
    }

    console.log("Reading deps.json");
    const deps = JSON.parse(
        fs.readFileSync(path.join(dir, "deps.json"), "utf8")
    );

    const packageDeps = Object.keys(deps.graph.dependencies);

    console.log(`Analyzing ${packageDeps.length} dependencies...`);

    for (const dep of packageDeps) {
        const dependencies = deps.graph.dependencies[dep].map(
            (d: { target: string }) => d.target
        );
        console.log(
            `Analyzing ${dep}, contains ${dependencies.length} dependencies total, counting imports for each...`
        );

        if (dependencies.length === 0) {
            console.log("No dependencies, skipping.");
            continue;
        }
        // for each dependency in deps, count the number of times it is imported.
        await countDependencies(dep, dependencies);
        console.log("\n");
    }

    async function countDependencies(pkg: string, dependencies: any[]) {
        const packageDir = path.join(dir, "packages", pkg);
        let actualDir = packageDir.replace("@glide/", "");

        if (pkg === "@glide/app") {
            actualDir = path.join(dir, "app");
        }

        if (pkg === "@glide/functions") {
            actualDir = path.join(dir, "functions");
        }

        const glob = new Glob("**/*.ts*");
        const tsFiles = await Array.fromAsync(glob.scan(actualDir));

        // Use a Map to store and count dependencies
        const dependencyCounts = new Map();

        // Updated regex to capture the full import path
        const importExportRegex = /from\s+['"](@?[^'"]+)['"]/g;

        tsFiles.forEach((file) => {
            const stats = fs.statSync(path.join(actualDir, file));
            if (stats.isDirectory()) {
                // Handle the error as needed: throw an error, return a specific value, etc.
                throw new Error(
                    `The path "${file}" is a directory, not a file.`
                );
            }

            let match;

            const matches = readFileAndParseImports(path.join(actualDir, file));
            for (const match of matches) {
                if (typeof match === "string") {
                    continue;
                }

                const importPath = match.path;
                const matchedDependency = dependencies.find(
                    (dep) =>
                        importPath === dep || importPath.startsWith(dep + "/")
                );
                if (matchedDependency) {
                    // Increment the count for the matched dependency
                    const currentCount =
                        dependencyCounts.get(matchedDependency) || 0;
                    dependencyCounts.set(matchedDependency, currentCount + 1);
                }
            }
        });

        console.log("Used dependencies and their counts:");
        // sort the dependencies by count
        const sortedDependencies = Array.from(dependencyCounts).sort(
            ([, countA], [, countB]) => countB - countA
        );
        sortedDependencies.forEach((count, dep) => {
            console.log(`${dep}: ${count}`);
        });
    }
}
