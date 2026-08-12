import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Config } from "./config";
import { CodeGenerator, CODE_PATTERN, isReserved } from "./codes";
import { Store, UniqueCodeError } from "./store";
import { ValidationError, validateCreate } from "./validate";

const MAX_CODE_ATTEMPTS = 1000;
const CLICKS_RETAINED = 100;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlPage(title: string, heading: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
<h1>${escapeHtml(heading)}</h1>
<p>${body}</p>
</body>
</html>
`;
}

/** Only GET /:code renders HTML — it is the sole route a human lands on. */
function notFoundHtml(code: string): string {
  return htmlPage(
    "Link not found",
    "This link does not exist",
    `We have no record of the short code <code>${escapeHtml(code)}</code>. ` +
      `It may have been mistyped &mdash; please check the code and try again.`,
  );
}

function goneHtml(code: string): string {
  return htmlPage(
    "Link expired",
    "This link has expired",
    `The short link <code>${escapeHtml(code)}</code> was real, but it has ` +
      `expired and no longer forwards anywhere. Please ask whoever shared it ` +
      `for an up-to-date link.`,
  );
}

function headerValue(
  req: FastifyRequest,
  name: string,
): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * Protocol-level prefetch signals. A declared prefetch redirects but is not a
 * click. Plain GETs from ordinary browsers are always counted (no UA sniffing).
 */
function isPrefetch(req: FastifyRequest): boolean {
  const secPurpose = headerValue(req, "sec-purpose");
  const purpose = headerValue(req, "purpose");
  return (
    (!!secPurpose && /prefetch/i.test(secPurpose)) ||
    (!!purpose && /prefetch/i.test(purpose))
  );
}

export interface AppDeps {
  config: Config;
  store: Store;
  generator?: CodeGenerator;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, store } = deps;
  const generator = deps.generator ?? new CodeGenerator();

  const app = Fastify({
    logger: false,
    // GET /:code/ must behave identically to GET /:code.
    ignoreTrailingSlash: true,
    exposeHeadRoutes: false,
  });

  // Every route except GET /:code answers with JSON errors.
  app.setErrorHandler((rawErr: unknown, _req, reply) => {
    const err = rawErr as { statusCode?: number; message?: string };
    const status =
      rawErr instanceof ValidationError
        ? 400
        : typeof err.statusCode === "number" && err.statusCode >= 400
          ? err.statusCode
          : 500;
    const message =
      status >= 500 ? "Internal Server Error" : err.message || "Bad Request";
    reply.code(status).type("application/json").send({ error: message });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).type("application/json").send({ error: "Not Found" });
  });

  // ---------------------------------------------------------------- health
  app.get("/health", async (_req, reply) => {
    reply.code(200).type("application/json").send({ status: "ok" });
  });

  // ----------------------------------------------------------- create link
  app.post("/links", async (req, reply) => {
    const input = validateCreate(req.body, config);
    const createdAt = new Date().toISOString();

    let code: string | null = null;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      // The seed queue is consumed BEFORE the reserved and collision checks,
      // so a seeded duplicate deterministically exercises the retry path.
      const candidate = generator.next().toLowerCase();
      if (isReserved(candidate)) continue;
      try {
        store.insertLink({
          code: candidate,
          url: input.url,
          createdAt,
          expiresAt: input.expiresAt,
        });
        code = candidate;
        break;
      } catch (err) {
        // Collision: the existing row is left untouched, and we try again.
        if (err instanceof UniqueCodeError) continue;
        throw err;
      }
    }

    if (code === null) {
      throw new Error("Unable to generate a unique short code");
    }

    reply.code(201).type("application/json").send({
      code,
      shortUrl: `${config.baseUrl}/${code}`,
      url: input.url,
      createdAt,
      expiresAt: input.expiresAt,
    });
  });

  // -------------------------------------------------------------- redirect
  const redirectHandler = async (
    req: FastifyRequest<{ Params: { code: string } }>,
    reply: FastifyReply,
  ) => {
    const raw = req.params.code;
    const code = raw.toLowerCase(); // lookup is case-insensitive everywhere

    const link =
      isReserved(code) || !CODE_PATTERN.test(code) ? null : store.getLink(code);

    if (!link) {
      reply.code(404).type("text/html; charset=utf-8").send(notFoundHtml(raw));
      return;
    }

    if (link.expiresAt !== null && Date.parse(link.expiresAt) <= Date.now()) {
      reply.code(410).type("text/html; charset=utf-8").send(goneHtml(raw));
      return;
    }

    // HEAD and declared prefetches redirect but do not count as clicks.
    if (req.method === "GET" && !isPrefetch(req)) {
      const referrer = headerValue(req, "referer") ?? null;
      store.recordClick(link.code, new Date().toISOString(), referrer);
    }

    // Location is the stored URL byte-for-byte: no normalisation, no re-encoding.
    reply
      .code(302)
      .header("location", link.url)
      .type("text/html; charset=utf-8")
      .send("");
  };

  app.route({
    method: ["GET", "HEAD"],
    url: "/:code",
    handler: redirectHandler as never,
  });

  // ----------------------------------------------------------------- stats
  app.get<{ Params: { code: string } }>("/:code/stats", async (req, reply) => {
    const code = req.params.code.toLowerCase();
    const link =
      isReserved(code) || !CODE_PATTERN.test(code) ? null : store.getLink(code);
    if (!link) {
      reply.code(404).type("application/json").send({ error: "Not Found" });
      return;
    }

    const clickCount = store.clickCount(link.code);
    reply.code(200).type("application/json").send({
      code: link.code,
      url: link.url,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      clickCount,
      referrers: store.referrers(link.code),
      clicks: store.recentClicks(link.code),
      clicksTruncated: clickCount > CLICKS_RETAINED,
    });
  });

  // ------------------------------------------------- test-only seam (SG-1)
  // Mounted only when ENABLE_TEST_HOOKS=1. In every other configuration these
  // paths fall through to the JSON 404 handler like any unknown route.
  if (config.enableTestHooks) {
    app.post("/__test__/next-codes", async (req, reply) => {
      const body = req.body as { codes?: unknown } | undefined;
      const codes = body?.codes;
      if (!Array.isArray(codes) || codes.some((c) => typeof c !== "string")) {
        throw new ValidationError("'codes' must be an array of strings");
      }
      generator.seed(codes as string[]);
      reply.code(204).send();
    });

    app.delete("/__test__/next-codes", async (_req, reply) => {
      generator.clear();
      reply.code(204).send();
    });
  }

  return app;
}
