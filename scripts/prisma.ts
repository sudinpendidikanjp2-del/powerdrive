import "../server/config/env.ts";
import { spawnSync } from "child_process";

// Runs the Prisma CLI with the same DATABASE_URL the server resolves,
// including the local default when DATABASE_URL is unset.
const result = spawnSync("npx", ["prisma", ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
