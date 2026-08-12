import { Config, effectivePort } from "./config";

export const MAX_URL_LENGTH = 2048;

export interface CreateInput {
  url: string;
  expiresAt: string | null;
}

export class ValidationError extends Error {}

function fail(message: string): never {
  throw new ValidationError(message);
}

/**
 * Validates a POST /links body. Never performs any network I/O — the target
 * URL is not fetched or checked for reachability.
 */
export function validateCreate(body: unknown, config: Config): CreateInput {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    fail("Request body must be a JSON object with a 'url' property");
  }
  const raw = body as Record<string, unknown>;

  const url = raw.url;
  if (typeof url !== "string") {
    fail(
      url === undefined
        ? "'url' is required"
        : "'url' must be a string containing an absolute http:// or https:// URL",
    );
  }

  // "Longer than 2048" is inclusive-accept: 2048 is valid, 2049 is not.
  // Length is the character count of the string as submitted.
  if (url.length > MAX_URL_LENGTH) {
    fail(`'url' must be at most ${MAX_URL_LENGTH} characters`);
  }
  if (url.length === 0) {
    fail("'url' must be an absolute http:// or https:// URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail("'url' must be an absolute http:// or https:// URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("'url' must be an absolute http:// or https:// URL");
  }
  if (!parsed.hostname) {
    fail("'url' must be an absolute http:// or https:// URL");
  }

  // Self-reference: host AND port must both match the configured base URL.
  // Host comparison is case-insensitive; an omitted port normalises to the
  // scheme default. The same host on a different port is a different service.
  if (
    parsed.hostname.toLowerCase() === config.baseHost &&
    effectivePort(parsed) === config.basePort
  ) {
    fail("'url' must not point at this shortener");
  }

  return { url, expiresAt: validateExpiresAt(raw.expiresAt) };
}

function validateExpiresAt(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    fail("'expiresAt' must be an ISO 8601 date-time string");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    fail("'expiresAt' must be an ISO 8601 date-time string");
  }
  if (parsed.getTime() <= Date.now()) {
    fail("'expiresAt' must be in the future");
  }
  return parsed.toISOString();
}
