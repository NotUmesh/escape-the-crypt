// Fast-feedback hook: runs the core tests when a file under packages/core/src is saved.
// CI remains the release gate. Writes no logs or files; output goes to stdout/stderr only.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

async function readAllStdin() {
  if (process.stdin.isTTY) return "";
  return await new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => finish(), 1000);
    const finish = () => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(data);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

function findFilePath(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return undefined;
  for (const key of ["file_path", "filePath", "path", "file"]) {
    const v = value[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  for (const v of Object.values(value)) {
    const found = findFilePath(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function isInsideCoreSrc(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return /(^|\/)packages\/core\/src\//.test(normalized);
}

const FULL_SUITE = ["--filter", "@escape-the-crypt/core", "test", "--run"];
const FOCUSED_SUITE = ["--filter", "@escape-the-crypt/core", "exec", "vitest", "run", "src/runtime", "src/locks"];

// Pure: picks the pnpm arguments for a saved path (either slash style).
export function buildTestArgs(filePath) {
  if (filePath !== undefined) {
    const normalized = filePath.replace(/\\/g, "/");
    if (/(^|\/)packages\/core\/src\/(runtime|locks)\//.test(normalized)) return FOCUSED_SUITE;
  }
  return FULL_SUITE;
}

async function main() {
  let filePath;
  try {
    const raw = (await readAllStdin()).trim();
    if (raw) filePath = findFilePath(JSON.parse(raw));
  } catch {
    filePath = undefined;
  }

  if (filePath !== undefined && !isInsideCoreSrc(filePath)) process.exit(0);

  const args = buildTestArgs(filePath);
  if (process.argv.includes("--dry-run")) {
    console.log(["pnpm", ...args].join(" "));
    process.exit(0);
  }

  const result = spawnSync("pnpm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.exit(typeof result.status === "number" ? result.status : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
