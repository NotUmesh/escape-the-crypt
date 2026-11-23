// Fast-feedback hook: runs the core tests when a file under packages/core/src is saved.
// CI remains the release gate. Writes no logs or files; output goes to stdout/stderr only.
import { spawnSync } from "node:child_process";

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

let filePath;
try {
  const raw = (await readAllStdin()).trim();
  if (raw) filePath = findFilePath(JSON.parse(raw));
} catch {
  filePath = undefined;
}

if (filePath !== undefined && !isInsideCoreSrc(filePath)) process.exit(0);

const result = spawnSync("pnpm", ["--filter", "@escape-the-crypt/core", "test", "--run"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(typeof result.status === "number" ? result.status : 1);
