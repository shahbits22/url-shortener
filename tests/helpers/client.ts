/**
 * Black-box HTTP client for the acceptance suite.
 *
 * Deliberately knows NOTHING about the implementation: no application imports,
 * no in-process injection, no database access. Everything goes over the wire to
 * BASE_URL, exactly as a real client would.
 */

/**
 * Read an env var through a dynamic key. Vite (which powers Vitest) statically
 * replaces literal `process.env.BASE_URL` member access with its own notion of a
 * base path, so the literal form must be avoided here.
 */
function env(name: string): string | undefined {
  const key = name;
  return (globalThis as any).process?.env?.[key];
}

/**
 * Target service. `BASE_URL` must be an absolute http(s) URL.
 *
 * Vitest populates `process.env.BASE_URL` with Vite's base path ("/") when the user
 * has not set one, so anything that is not an absolute URL is treated as unset.
 * `SUT_BASE_URL` takes precedence and is the unambiguous way to point the suite.
 */
function resolveBaseUrl(): string {
  for (const candidate of [env("SUT_BASE_URL"), env("BASE_URL")]) {
    if (candidate && /^https?:\/\/[^/]+/i.test(candidate)) {
      return candidate.replace(/\/+$/, "");
    }
  }
  return "http://localhost:3000";
}

export const BASE_URL = resolveBaseUrl();

/** Test-only hooks the service exposes when started with ENABLE_TEST_HOOKS=1 (see tests/README.md). */
export const TEST_HOOKS_ENABLED = env("TEST_HOOKS") === "1";
/** Shell command that restarts the service in place, preserving its data store. */
export const RESTART_CMD = env("RESTART_CMD") ?? "";

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: string;
  /** Parsed JSON body, or undefined when the body is not valid JSON. */
  json: any;
  contentType: string;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Perform a request WITHOUT following redirects — every redirect assertion depends on this. */
export async function request(path: string, options: RequestOptions = {}): Promise<HttpResponse> {
  const { method = "GET", headers = {}, body } = options;
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;

  const init: RequestInit = { method, redirect: "manual", headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] ??= "application/json";
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return {
    status: res.status,
    headers: res.headers,
    body: text,
    json: parsed,
    contentType: res.headers.get("content-type") ?? "",
  };
}

export interface CreatedLink {
  code: string;
  shortUrl: string;
  url: string;
  createdAt: string;
  expiresAt?: string | null;
}

/** POST /links and assert a 201. Returns the created link body. */
export async function createLink(
  url: string,
  extra: Record<string, unknown> = {},
): Promise<CreatedLink> {
  const res = await request("/links", { method: "POST", body: { url, ...extra } });
  if (res.status !== 201) {
    throw new Error(`createLink expected 201 for ${url}, got ${res.status}: ${res.body}`);
  }
  return res.json as CreatedLink;
}

/** A unique, syntactically valid target URL that is never actually fetched by the service. */
let counter = 0;
export function uniqueTargetUrl(label = "t"): string {
  counter += 1;
  return `https://example.com/${label}/${Date.now()}-${counter}`;
}

export async function getStats(code: string): Promise<HttpResponse> {
  return request(`/${code}/stats`);
}

/** ISO 8601, UTC, trailing Z — e.g. 2026-08-12T11:00:00.000Z or 2026-08-12T11:00:00Z */
export const UTC_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

export function expectUtcIso(value: unknown): void {
  if (typeof value !== "string" || !UTC_ISO_RE.test(value)) {
    throw new Error(`expected ISO 8601 UTC timestamp with trailing Z, got ${JSON.stringify(value)}`);
  }
  if (Number.isNaN(Date.parse(value as string))) {
    throw new Error(`timestamp is not parseable: ${value}`);
  }
}

export const SHORT_CODE_RE = /^[0-9a-z]{7}$/;

export function isoInFuture(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function isoInPast(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until GET /health answers 200, or throw. Used after a restart. */
export async function waitForHealthy(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "never attempted";
  while (Date.now() < deadline) {
    try {
      const res = await request("/health");
      if (res.status === 200) return;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = String(err);
    }
    await sleep(250);
  }
  throw new Error(`service at ${BASE_URL} did not become healthy in ${timeoutMs}ms (${lastError})`);
}
