import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const playwrightEntry = require.resolve("playwright");
const playwrightCli = path.join(path.dirname(playwrightEntry), "cli.js");
const result = spawnSync(process.execPath, [playwrightCli, "install", "chromium"], {
  cwd: backendDirectory,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
