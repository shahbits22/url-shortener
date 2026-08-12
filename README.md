# url-shortner

URL shortener with click analytics. See issue #1 for the specification.

## Run

```bash
npm ci && npm run build && npm start
```

Listens on `PORT` (default `3000`).

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Listen port |
| `BASE_URL` | `http://localhost:3000` | Public base URL; used to build `shortUrl` and to detect self-referential targets |
| `DATA_FILE` | `data/url-shortener.db` | SQLite data file (relative paths resolve against the repo root); reopened, never recreated |
| `ENABLE_TEST_HOOKS` | unset | When exactly `1`, mounts the test-only generator seam at `/__test__/next-codes`. Never set this outside a local test run |
| `RUNTIME_FILE` | `.runtime/server.json` | Where the running process records its pid and configuration, for `npm run restart` |

## API

| Route | Behaviour |
| --- | --- |
| `POST /links` | `{"url": "...", "expiresAt": "..."}` → `201` with `code`, `shortUrl`, `url`, `createdAt`, `expiresAt` |
| `GET \| HEAD /:code` | `302` to the stored URL. `GET` records a click; `HEAD` and declared prefetches do not. `404`/`410` render HTML |
| `GET /:code/stats` | `200` with `clickCount`, `referrers`, `clicks` (100 most recent), `clicksTruncated` |
| `GET /health` | `200` readiness probe |

Codes are 7-character lowercase base36 and resolve case-insensitively on every route.

## Restart

```bash
npm run restart   # same port, same BASE_URL, same data file; poll GET /health for readiness
npm run stop      # stop without restarting
```
