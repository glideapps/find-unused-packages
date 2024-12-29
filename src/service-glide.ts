import fs from "fs";
import path from "path";
import { resolveImportsInDirectories } from "./resolve-imports";
import { removeReExports } from "./remove-re-exports";
import { dedupImports } from "./dedup-imports";
import { fixPackageUse } from "./fix-package-use";
import { prettier } from "./prettier";
import { concurrentForEach } from "./concurrent";

export async function serviceGlide(repoPath: string) {
    repoPath = path.resolve(repoPath);

    const packageNames = fs
        .readFileSync(path.join(repoPath, ".topological-packages"), "utf-8")
        .split("\n")
        .map((n) => n.trim())
        .filter((n) => n !== "");

    const allSourcePaths = [
        ...packageNames.map((n) => path.join(repoPath, "packages", n, "src")),
        path.join(repoPath, "functions", "src"),
        path.join(repoPath, "app", "src"),
    ];

    console.log("resolving imports");
    const resolveModified = await resolveImportsInDirectories(
        path.join(repoPath, "packages"),
        allSourcePaths,
        false
    );

    console.log("removing re-exports");
    const removeModified = await removeReExports(allSourcePaths);

    console.log("de-duping imports");
    const dedupModified = await dedupImports(allSourcePaths, false);

    console.log("fixing package use");
    for (const packageName of packageNames) {
        const packageDir = path.join(repoPath, "packages", packageName);
        await fixPackageUse(packageDir, true);
    }

    const allModifiedFiles = new Set([
        ...resolveModified,
        ...removeModified,
        ...dedupModified,
    ]);
    if (allModifiedFiles.size === 0) {
        console.log("No TypeScript file was modified.");
        return;
    }

    console.log(
        `Modified ${allModifiedFiles.size} TypeScript files - running prettier`
    );
    await concurrentForEach(allModifiedFiles, 10, prettier);
}