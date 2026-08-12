import fs from "node:fs";
import path from "node:path";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { Store } from "./store";

/**
 * Snapshot of the running process, written on boot and read by
 * scripts/restart.mjs so a restart can come back up on the same PORT and
 * BASE_URL against the same data file.
 */
export interface RuntimeInfo {
  pid: number;
  port: number;
  baseUrl: string;
  dataFile: string;
  enableTestHooks: boolean;
  startedAt: string;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new Store(config.dataFile);
  const app = buildApp({ config, store });

  await listenWithRetry(app, config.port);

  const info: RuntimeInfo = {
    pid: process.pid,
    port: config.port,
    baseUrl: config.baseUrl,
    dataFile: config.dataFile,
    enableTestHooks: config.enableTestHooks,
    startedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(config.runtimeFile), { recursive: true });
  fs.writeFileSync(config.runtimeFile, JSON.stringify(info, null, 2));

  // eslint-disable-next-line no-console
  console.log(
    `url-shortener listening on port ${config.port} (base ${config.baseUrl}, data ${config.dataFile}` +
      `${config.enableTestHooks ? ", TEST HOOKS ENABLED" : ""})`,
  );

  let closing = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
    } finally {
      store.close(); // closes the file; never deletes or truncates it
      try {
        const current = JSON.parse(
          fs.readFileSync(config.runtimeFile, "utf8"),
        ) as RuntimeInfo;
        // Only clear the runtime file if it still describes this process.
        if (current.pid === process.pid) fs.rmSync(config.runtimeFile);
      } catch {
        /* nothing to clean up */
      }
      process.exit(signal === "SIGTERM" || signal === "SIGINT" ? 0 : 1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/**
 * A restart re-binds the port moments after the previous process released it;
 * retry briefly rather than dying on a transient EADDRINUSE.
 */
async function listenWithRetry(
  app: ReturnType<typeof buildApp>,
  port: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await app.listen({ port, host: "0.0.0.0" });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" || Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
