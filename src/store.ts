import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";

export interface LinkRow {
  code: string;
  url: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface ClickRow {
  timestamp: string;
  referrer: string | null;
}

export interface ReferrerRow {
  referrer: string | null;
  count: number;
}

export class UniqueCodeError extends Error {}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  return (
    e.code === "ERR_SQLITE_ERROR" &&
    typeof e.message === "string" &&
    /UNIQUE constraint failed/i.test(e.message)
  );
}

/**
 * SQLite-backed store.
 *
 * All operations are synchronous (node:sqlite). Because Node runs the request
 * handlers on a single thread, a synchronous INSERT cannot interleave with
 * another request's INSERT — there is no read-modify-write window and therefore
 * no lost update. Click counts are derived with COUNT(*) over an append-only
 * `clicks` table rather than held in a counter column, so N concurrent
 * redirects always yield exactly N clicks.
 */
export class Store {
  private db: DatabaseSync;
  private insertLinkStmt: StatementSync;
  private getLinkStmt: StatementSync;
  private insertClickStmt: StatementSync;
  private countClicksStmt: StatementSync;
  private recentClicksStmt: StatementSync;
  private referrersStmt: StatementSync;

  constructor(dataFile: string) {
    if (dataFile !== ":memory:") {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    }
    // DatabaseSync opens an existing file in place and only creates one when
    // it is absent. Nothing here truncates or replaces the file.
    this.db = new DatabaseSync(dataFile);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS links (
        code       TEXT PRIMARY KEY,
        url        TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS clicks (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        code     TEXT NOT NULL,
        ts       TEXT NOT NULL,
        referrer TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_clicks_code_id ON clicks (code, id);
    `);

    this.insertLinkStmt = this.db.prepare(
      "INSERT INTO links (code, url, created_at, expires_at) VALUES (?, ?, ?, ?)",
    );
    this.getLinkStmt = this.db.prepare(
      "SELECT code, url, created_at, expires_at FROM links WHERE code = ?",
    );
    this.insertClickStmt = this.db.prepare(
      "INSERT INTO clicks (code, ts, referrer) VALUES (?, ?, ?)",
    );
    this.countClicksStmt = this.db.prepare(
      "SELECT COUNT(*) AS n FROM clicks WHERE code = ?",
    );
    this.recentClicksStmt = this.db.prepare(
      "SELECT ts, referrer FROM clicks WHERE code = ? ORDER BY id DESC LIMIT 100",
    );
    this.referrersStmt = this.db.prepare(
      "SELECT referrer, COUNT(*) AS n FROM clicks WHERE code = ? " +
        "GROUP BY referrer ORDER BY n DESC, referrer IS NULL, referrer ASC",
    );
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }

  /**
   * Insert a link. Throws UniqueCodeError when `code` is already taken; the
   * pre-existing row is never touched (plain INSERT, no upsert/replace).
   */
  insertLink(link: LinkRow): void {
    try {
      this.insertLinkStmt.run(
        link.code,
        link.url,
        link.createdAt,
        link.expiresAt,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new UniqueCodeError(link.code);
      throw err;
    }
  }

  getLink(code: string): LinkRow | null {
    const row = this.getLinkStmt.get(code) as
      | {
          code: string;
          url: string;
          created_at: string;
          expires_at: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      code: row.code,
      url: row.url,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? null,
    };
  }

  recordClick(code: string, timestamp: string, referrer: string | null): void {
    this.insertClickStmt.run(code, timestamp, referrer);
  }

  clickCount(code: string): number {
    const row = this.countClicksStmt.get(code) as { n: number };
    return Number(row.n);
  }

  /** 100 most recent clicks, newest first. Oldest entries are the dropped ones. */
  recentClicks(code: string): ClickRow[] {
    return (
      this.recentClicksStmt.all(code) as unknown as {
        ts: string;
        referrer: string | null;
      }[]
    ).map((r) => ({ timestamp: r.ts, referrer: r.referrer ?? null }));
  }

  /** Aggregated over ALL clicks ever recorded, not just the retained 100. */
  referrers(code: string): ReferrerRow[] {
    return (
      this.referrersStmt.all(code) as unknown as {
        referrer: string | null;
        n: number;
      }[]
    ).map((r) => ({ referrer: r.referrer ?? null, count: Number(r.n) }));
  }
}
