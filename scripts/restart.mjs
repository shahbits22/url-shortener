#!/usr/bin/env node
/**
 * `npm run restart` — stop the running service and start it again on the same
 * PORT and BASE_URL, pointed at the SAME data file.
 *
 * It never deletes, moves, or truncates the data file: it only signals the old
 * process and spawns a new one with the recorded configuration. It returns once
 * the restart has been initiated; readiness is observed via `GET /health`.
 *
 * Scope is deliberately one script — no supervision, no crash-restart policy.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_FILE = path.resolve(
  ROOT,
  process.env.RUNTIME_FILE ?? path.join(".runtime", "server.json"),
);
const SERVER_ENTRY = path.join(ROOT, "dist", "server.js");
const STOP_ONLY = process.argv.includes("--stop-only");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readRuntime() {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8"));
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

async function stop(pid) {
  if (!alive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 10_000;
  while (alive(pid) && Date.now() < deadline) await sleep(100);
  if (alive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    while (alive(pid) && Date.now() < deadline + 5_000) await sleep(100);
  }
}

const previous = readRuntime();

if (previous?.pid) await stop(previous.pid);

if (STOP_ONLY) process.exit(0);

if (!fs.existsSync(SERVER_ENTRY)) {
  console.error(`Build output missing at ${SERVER_ENTRY}. Run: npm run build`);
  process.exit(1);
}

// The recorded configuration wins over ambient env so the service comes back on
// the same port and against the same data file regardless of who invoked this.
const env = { ...process.env };
if (previous) {
  env.PORT = String(previous.port);
  env.BASE_URL = previous.baseUrl;
  env.DATA_FILE = previous.dataFile;
  if (previous.enableTestHooks) env.ENABLE_TEST_HOOKS = "1";
  else delete env.ENABLE_TEST_HOOKS;
}

fs.mkdirSync(path.dirname(RUNTIME_FILE), { recursive: true });
const logPath = path.join(path.dirname(RUNTIME_FILE), "server.log");
const out = fs.openSync(logPath, "a");

const child = spawn(process.execPath, [SERVER_ENTRY], {
  cwd: ROOT,
  env,
  detached: true,
  stdio: ["ignore", out, out],
});
child.unref();

console.log(
  `restarted url-shortener (pid ${child.pid}) on port ${env.PORT ?? "3000"}; logs: ${logPath}`,
);
process.exit(0);
