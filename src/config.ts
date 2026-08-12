import path from "node:path";

/**
 * Repo root. At runtime this file lives at <root>/dist/config.js, so the root
 * is one directory up. Resolving from __dirname (rather than process.cwd())
 * keeps the default data-file path stable no matter where the process is
 * started from — which matters for `npm run restart`, which must reopen the
 * *same* file.
 */
export const ROOT = path.resolve(__dirname, "..");

export interface Config {
  port: number;
  /** Public base URL, never with a trailing slash. */
  baseUrl: string;
  baseHost: string;
  basePort: string;
  dataFile: string;
  enableTestHooks: boolean;
  runtimeFile: string;
}

/** An omitted port normalises to the scheme default before comparison. */
export function effectivePort(u: URL): string {
  if (u.port) return u.port;
  return u.protocol === "https:" ? "443" : "80";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number.parseInt(env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  const rawBase = (env.BASE_URL ?? "http://localhost:3000").trim();
  const baseUrl = rawBase.replace(/\/+$/, "");
  let parsedBase: URL;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid BASE_URL: ${rawBase}`);
  }

  const dataFile = path.resolve(
    ROOT,
    env.DATA_FILE ?? path.join("data", "url-shortener.db"),
  );

  return {
    port,
    baseUrl,
    baseHost: parsedBase.hostname.toLowerCase(),
    basePort: effectivePort(parsedBase),
    dataFile,
    enableTestHooks: env.ENABLE_TEST_HOOKS === "1",
    runtimeFile: path.resolve(
      ROOT,
      env.RUNTIME_FILE ?? path.join(".runtime", "server.json"),
    ),
  };
}
