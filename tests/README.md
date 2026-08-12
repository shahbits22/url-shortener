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

### Full coverage — the suite must be run TWICE

**No single invocation runs all 52 tests, and that is by design.** `SEC-1` asserts that
the generator seam is *absent* in the default configuration, so it can only run with
the seam unmounted. `AC-C14` and `AC-C12b` need the seam mounted. The two are mutually
exclusive; each run skips what the other covers.

| Pass | Service | Suite | Result |
| --- | --- | --- | --- |
| 1 — default | `PORT=3000 npm start` | `RESTART_CMD=… npm test` | 50 passed, 2 skipped (`AC-C14`, `AC-C12b`) |
| 2 — hooked | `ENABLE_TEST_HOOKS=1 PORT=3000 npm start` | `TEST_HOOKS=1 RESTART_CMD=… npm test` | 51 passed, 1 skipped (`SEC-1`) |

Full coverage is the **union**: 52/52 with zero failures. Restart the service between
passes so the seam is genuinely unmounted in pass 1 — do not just change the suite-side
variable.

```bash
# ---- pass 1: default configuration (SEC-1 runs here) ----
rm -rf data .runtime
PORT=3000 npm start &                       # from the repo root
cd tests
RESTART_CMD="npm --prefix .. run restart" npm test
cd .. && npm run stop

# ---- pass 2: generator seam mounted (AC-C14 / AC-C12b run here) ----
rm -rf data .runtime
ENABLE_TEST_HOOKS=1 PORT=3000 npm start &
cd tests
TEST_HOOKS=1 RESTART_CMD="npm --prefix .. run restart" npm test
cd .. && npm run stop
```

> **Do not run only pass 2.** It looks like the more thorough configuration and it is
> not. `SEC-1` is the *entire* accepted mitigation for the test-seam attack surface
> (see the out-of-scope section of the spec): it is what catches a build that leaves
> `/__test__/*` mounted when `ENABLE_TEST_HOOKS` is unset. Running only the hooked
> pass silently skips it — the one configuration in which that check is meaningless.
> `.github/workflows/pr.yml` runs both passes for this reason.

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
asserts this, and it therefore runs **only** in the default configuration (pass 1).
Note that `SEC-1` probes the `POST` route only; the `DELETE` route's `404` in the
default configuration is not yet asserted by a test. See the follow-up noted in QA's
review comment on PR #3.

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
