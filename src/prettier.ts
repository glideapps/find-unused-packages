import { $ } from "bun";
import path from "path";

export async function prettier(filePath: string) {
    const { dir, base } = path.parse(filePath);
    const result = await $`npx prettier --write ${base}`.cwd(dir);
    if (result.exitCode !== 0) {
        console.error("Prettier failed:", result.stderr);
        process.exit(1);
    }
}
