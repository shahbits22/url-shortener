# Acceptance test suite — issue #1, Revision 2

Black-box HTTP acceptance tests written by QA **before** any implementation existed.
The suite imports no application module and uses no framework-specific in-process
injection: every assertion is made over the wire against a running service at
`BASE_URL`. It is therefore implementation-agnostic — any stack that satisfies the
contract below passes it.

**These tests are expected to fail until Dev implements the service. That is the point.**

## Service contract this suite tests against

Dev implements against this contract; the suite assumes nothing else.

| Item | Contract |
| --- | --- |
| Listen port | `PORT` env var, **default `3000`** |
| Public base URL | `BASE_URL` env var on the *service* (used to build `shortUrl` and to detect self-referential targets), default `http://localhost:3000` |
| Start command | from the repo root: `npm ci && npm run build && npm start` |
| Health | `GET /health` returns `200` once the service is ready to serve |
| Test target | the suite reads `BASE_URL` (default `http://localhost:3000`) |
| Persistence | the data store survives a process restart and is reopened on boot |
| Restart hook | `RESTART_CMD` (suite-side env var): a shell command that stops and restarts the service against the **same** data store |
| Generator hook | `POST /__test__/next-codes` / `DELETE /__test__/next-codes`, mounted **only** when the service is started with `ENABLE_TEST_HOOKS=1` |

Redirect assertions are made with `redirect: "manual"` — the suite never follows a
`Location`, so the service is never asked to serve `example.com`. No test makes an
outbound request to any third-party host.

## Running

```bash
# 1. start the service (repo root, separate shell)
npm ci && npm run build && npm start

# 2. run the suite
cd tests
npm ci
npm test
```

Against another host or port:

```bash
BASE_URL=http://localhost:8080 npm test
```

### Full coverage (all criteria, nothing skipped)

Two criteria need a hook — without them those tests skip and coverage is incomplete:

```bash
# service, started with the generator hook mounted
ENABLE_TEST_HOOKS=1 PORT=3000 npm start

# suite
cd tests
TEST_HOOKS=1 RESTART_CMD="<command that restarts the service in place>" npm test
```

`RESTART_CMD` must:

1. stop the running service process,
2. start it again with the same `PORT`/`BASE_URL` and pointed at the **same** data
   file (do **not** wipe or recreate the store),
3. return once the restart has been initiated — the suite then polls `GET /health`
   until it answers `200`.

Example for a docker-compose setup: `RESTART_CMD="docker compose restart api"`.
Example for a pm2/foreman setup: `RESTART_CMD="pm2 restart url-shortener"`.
If Dev adds an npm script for it (e.g. `npm run restart` at the repo root),
`RESTART_CMD="npm --prefix .. run restart"` works from `tests/`.

### Generator hook (`ENABLE_TEST_HOOKS=1`)

Required to test collision retry (AC-C14) and reserved-code regeneration (AC-C12b).

```
POST /__test__/next-codes
{"codes": ["aaaaaaa", "aaaaaaa", "bbbbbbb"]}
-> 204
```

The next N codes the generator returns are exactly these, in order, **before** the
collision and reserved-path checks run — so seeding a duplicate forces the retry
path. When the queue drains, generation reverts to random.

```
DELETE /__test__/next-codes -> 204     (clears the queue)
```

The hook must be **absent (404) when `ENABLE_TEST_HOOKS` is not set** — `SEC-1`
asserts this, and it runs in the default configuration.

## Layout

| File | Covers |
| --- | --- |
| `spec/01-create.test.ts` | `POST /links` — creation and all validation |
| `spec/02-redirect.test.ts` | `GET`/`HEAD` `/:code` — redirect, click recording, 404/410 |
| `spec/03-analytics.test.ts` | `GET /:code/stats` |
| `spec/04-concurrency.test.ts` | lost-update safety on the click counter |
| `spec/05-operational.test.ts` | `/health`, reserved paths, restart persistence |
| `spec/06-seeded-generator.test.ts` | collision retry / reserved regeneration (hooked) |

Test names carry an `AC-*` id; the mapping from id to acceptance criterion is in the
QA comment on issue #1.

## Notes on suite behaviour

- Files run **sequentially in a single worker** (`fileParallelism: false`). Several
  tests assert exact per-link click counts and one restarts the process.
- Each test creates its own links, so tests never interfere with one another.
- Expiry tests create links with a ~1.5s TTL and sleep past it; the suite takes
  roughly 15-30 seconds end to end.
- The suite leaves data behind (links and clicks). That is harmless, but a fresh
  store per run makes failures easier to read.
