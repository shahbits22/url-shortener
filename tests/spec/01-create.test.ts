import { describe, expect, it } from "vitest";
import {
  BASE_URL,
  SHORT_CODE_RE,
  createLink,
  expectUtcIso,
  isoInFuture,
  isoInPast,
  request,
  uniqueTargetUrl,
} from "../helpers/client.js";

describe("Creating a short link — POST /links", () => {
  it("AC-C1: returns 201 with code, shortUrl, url, createdAt", async () => {
    const target = uniqueTargetUrl("create");
    const res = await request("/links", { method: "POST", body: { url: target } });

    expect(res.status).toBe(201);
    expect(res.contentType).toMatch(/application\/json/);
    expect(res.json).toBeDefined();
    expect(res.json).toHaveProperty("code");
    expect(res.json).toHaveProperty("shortUrl");
    expect(res.json).toHaveProperty("url", target);
    expect(res.json).toHaveProperty("createdAt");
    expectUtcIso(res.json.createdAt);
  });

  it("AC-C2: the returned code matches ^[0-9a-z]{7}$ (lowercase base36, exactly 7 chars)", async () => {
    // Ten links, so a single lucky all-lowercase base62 code cannot pass this by accident.
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      codes.push((await createLink(uniqueTargetUrl("alphabet"))).code);
    }
    for (const code of codes) {
      expect(code).toMatch(SHORT_CODE_RE);
      expect(code).toHaveLength(7);
      expect(code).toBe(code.toLowerCase());
    }
  });

  it("AC-C3: shortUrl equals the configured base URL joined to code", async () => {
    const link = await createLink(uniqueTargetUrl("shorturl"));
    expect(link.shortUrl).toBe(`${BASE_URL}/${link.code}`);
  });

  it("AC-C4: missing url field returns 400 with a JSON {error} body and persists nothing", async () => {
    const res = await request("/links", { method: "POST", body: {} });

    expect(res.status).toBe(400);
    expect(res.contentType).toMatch(/application\/json/);
    expect(res.json).toBeDefined();
    expect(typeof res.json.error).toBe("string");
    expect(res.json.error.length).toBeGreaterThan(0);
    // "persists nothing": no code may be handed back for a rejected request.
    expect(res.json.code).toBeUndefined();
    expect(res.json.shortUrl).toBeUndefined();
  });

  it("AC-C5: a url that is not an absolute http(s) URL returns 400", async () => {
    const invalid: unknown[] = [
      "notaurl",
      "ftp://x.com",
      "/relative/path",
      "",
      "javascript:alert(1)",
      "example.com",
      "//example.com/x",
      null,
      123,
      true,
      { url: "https://example.com" },
      ["https://example.com"],
    ];

    for (const value of invalid) {
      const res = await request("/links", { method: "POST", body: { url: value } });
      expect(
        res.status,
        `expected 400 for url=${JSON.stringify(value)}, got ${res.status} ${res.body}`,
      ).toBe(400);
      expect(res.contentType).toMatch(/application\/json/);
      expect(typeof res.json?.error).toBe("string");
    }
  });

  it("AC-C5b: a completely malformed request body returns 400, never 5xx (malformed-input requirement)", async () => {
    const cases: string[] = ["", "not json at all", "{", "[]", '"a string"', "null", "42"];
    for (const raw of cases) {
      const res = await request("/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw,
      });
      expect(
        res.status,
        `expected 4xx for raw body ${JSON.stringify(raw)}, got ${res.status}`,
      ).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it("AC-C6: a url longer than 2048 characters returns 400", async () => {
    const tooLong = `https://example.com/${"a".repeat(2100)}`;
    expect(tooLong.length).toBeGreaterThan(2048);
    const res = await request("/links", { method: "POST", body: { url: tooLong } });
    expect(res.status).toBe(400);
    expect(typeof res.json?.error).toBe("string");
  });

  it("AC-C6b: a url of exactly 2048 characters is accepted (boundary of 'longer than 2048')", async () => {
    const prefix = "https://example.com/";
    const url = prefix + "a".repeat(2048 - prefix.length);
    expect(url).toHaveLength(2048);
    const res = await request("/links", { method: "POST", body: { url } });
    expect(res.status).toBe(201);
  });

  it("AC-C7: a url whose host and port match the configured base URL returns 400 (self-referential)", async () => {
    const base = new URL(BASE_URL);
    const selfReferential = [
      BASE_URL,
      `${BASE_URL}/`,
      `${BASE_URL}/ab3de9f`,
      `${BASE_URL}/ab3de9f/stats`,
      `${base.protocol}//${base.host}/some/deep/path?x=1`,
    ];

    for (const url of selfReferential) {
      const res = await request("/links", { method: "POST", body: { url } });
      expect(res.status, `expected 400 for self-referential url ${url}, got ${res.status}`).toBe(
        400,
      );
      expect(typeof res.json?.error).toBe("string");
    }
  });

  it("AC-C7b: a url on the same host but a different port is NOT self-referential and is accepted", async () => {
    const base = new URL(BASE_URL);
    const otherPort = String((Number(base.port || "80") + 1) % 65535 || 8081);
    const res = await request("/links", {
      method: "POST",
      body: { url: `${base.protocol}//${base.hostname}:${otherPort}/elsewhere` },
    });
    expect(res.status).toBe(201);
  });

  it("AC-C8: creation performs no outbound request — an unresolvable host still returns 201", async () => {
    const started = Date.now();
    const res = await request("/links", {
      method: "POST",
      body: { url: `https://this-host-does-not-resolve-${Date.now()}.invalid/deep/path` },
    });
    expect(res.status).toBe(201);
    expect(res.json.code).toMatch(SHORT_CODE_RE);
    // A DNS lookup attempt would show up as multi-second latency.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("AC-C9: submitting the same URL twice returns two different codes (no deduplication)", async () => {
    const target = uniqueTargetUrl("dupe");
    const first = await createLink(target);
    const second = await createLink(target);

    expect(first.code).not.toBe(second.code);
    expect(first.url).toBe(target);
    expect(second.url).toBe(target);
  });

  it("AC-C10: expiresAt is optional; when omitted the link never expires and reports expiresAt null", async () => {
    const link = await createLink(uniqueTargetUrl("noexpiry"));
    expect(link.expiresAt ?? null).toBeNull();

    const stats = await request(`/${link.code}/stats`);
    expect(stats.status).toBe(200);
    expect(stats.json.expiresAt).toBeNull();

    // And it still redirects.
    const redirect = await request(`/${link.code}`);
    expect(redirect.status).toBe(302);
  });

  it("AC-C10b: a valid future expiresAt is accepted and echoed back as UTC ISO 8601", async () => {
    const expiresAt = isoInFuture(60 * 60 * 1000);
    const res = await request("/links", {
      method: "POST",
      body: { url: uniqueTargetUrl("expiry"), expiresAt },
    });

    expect(res.status).toBe(201);
    expectUtcIso(res.json.expiresAt);
    expect(Date.parse(res.json.expiresAt)).toBe(Date.parse(expiresAt));
  });

  it("AC-C11: an expiresAt in the past returns 400", async () => {
    for (const expiresAt of [isoInPast(1000), isoInPast(86_400_000), "1999-01-01T00:00:00Z"]) {
      const res = await request("/links", {
        method: "POST",
        body: { url: uniqueTargetUrl("pastexpiry"), expiresAt },
      });
      expect(res.status, `expected 400 for expiresAt=${expiresAt}, got ${res.status}`).toBe(400);
      expect(typeof res.json?.error).toBe("string");
    }
  });

  it("AC-C12: reserved paths are never issued as codes (sampled — see spec gap SG-2)", async () => {
    // A pure black-box sample cannot prove the generator excludes 'links'/'health':
    // both are 5-6 chars and the alphabet is 7 chars, so they are unreachable anyway
    // for a conforming generator. This test verifies the observable half — the
    // reserved paths do not behave as short codes — and the generator-level
    // guarantee is exercised in 06-seeded-generator.test.ts via the test hook.
    const codes = new Set<string>();
    for (let i = 0; i < 25; i++) {
      codes.add((await createLink(uniqueTargetUrl("reserved"))).code);
    }
    expect(codes.has("links")).toBe(false);
    expect(codes.has("health")).toBe(false);
    expect(codes.size).toBe(25); // 25 distinct codes: no duplicate ever issued
  });
});
