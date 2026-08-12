import { describe, expect, it } from "vitest";
import {
  createLink,
  expectUtcIso,
  getStats,
  isoInFuture,
  request,
  sleep,
  uniqueTargetUrl,
} from "../helpers/client.js";

describe("Redirecting — GET /:code", () => {
  it("AC-R1: an existing, unexpired code returns 302 with Location exactly equal to the stored URL", async () => {
    const target = "https://example.com/some/long/path?a=1&b=two#frag";
    const link = await createLink(target);

    const res = await request(`/${link.code}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(target);
  });

  it("AC-R2: the redirect status is 302, not 301 (clicks must not be cached by the browser)", async () => {
    const link = await createLink(uniqueTargetUrl("status"));
    const res = await request(`/${link.code}`);

    expect(res.status).toBe(302);
    expect(res.status).not.toBe(301);
    expect(res.status).not.toBe(308);
  });

  it("AC-R3: code lookup is case-insensitive on /:code and every variant records a click", async () => {
    const target = uniqueTargetUrl("case");
    const link = await createLink(target);
    const upper = link.code.toUpperCase();
    const mixed = link.code
      .split("")
      .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c))
      .join("");

    for (const variant of [link.code, upper, mixed]) {
      const res = await request(`/${variant}`);
      expect(res.status, `expected 302 for /${variant}`).toBe(302);
      expect(res.headers.get("location")).toBe(target);
    }

    const stats = await getStats(link.code);
    expect(stats.status).toBe(200);
    expect(stats.json.clickCount).toBe(3);
  });

  it("AC-R3b: code lookup is case-insensitive on /:code/stats too (UX follow-up note)", async () => {
    const link = await createLink(uniqueTargetUrl("casestats"));
    await request(`/${link.code}`);

    const upper = await getStats(link.code.toUpperCase());
    const mixed = await getStats(
      link.code
        .split("")
        .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c))
        .join(""),
    );

    for (const res of [upper, mixed]) {
      expect(res.status, `stats lookup must be case-insensitive, got ${res.status}`).toBe(200);
      expect(res.json.clickCount).toBe(1);
      expect(res.json.url).toBe(link.url);
    }
    // The canonical code is reported in lowercase regardless of how it was requested.
    expect(upper.json.code.toLowerCase()).toBe(link.code.toLowerCase());
  });

  it("AC-R4: GET /:code/ (trailing slash) behaves identically to GET /:code", async () => {
    const target = uniqueTargetUrl("slash");
    const link = await createLink(target);

    const plain = await request(`/${link.code}`);
    const slashed = await request(`/${link.code}/`);

    expect(slashed.status).toBe(plain.status);
    expect(slashed.status).toBe(302);
    expect(slashed.headers.get("location")).toBe(target);

    const stats = await getStats(link.code);
    expect(stats.json.clickCount).toBe(2); // both requests counted
  });

  it("AC-R5: GET /:code/<anything-other-than-stats> returns 404 and records no click", async () => {
    const link = await createLink(uniqueTargetUrl("subpath"));

    for (const suffix of ["anything-else", "statistics", "stats/extra", "x/y", "STATS2"]) {
      const res = await request(`/${link.code}/${suffix}`);
      expect(res.status, `expected 404 for /${link.code}/${suffix}, got ${res.status}`).toBe(404);
    }

    const stats = await getStats(link.code);
    expect(stats.json.clickCount).toBe(0);
    expect(stats.json.clicks).toEqual([]);
  });

  it("AC-R6: each redirecting GET records exactly one click with a UTC timestamp and the Referer header", async () => {
    const link = await createLink(uniqueTargetUrl("referer"));
    const before = Date.now() - 1000;

    await request(`/${link.code}`, { headers: { referer: "https://news.example.org/article" } });
    await request(`/${link.code}`); // no Referer -> null

    const stats = await getStats(link.code);
    expect(stats.json.clickCount).toBe(2);
    expect(stats.json.clicks).toHaveLength(2);

    for (const click of stats.json.clicks) {
      expectUtcIso(click.timestamp);
      const t = Date.parse(click.timestamp);
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(Date.now() + 1000);
    }

    const referrers = stats.json.clicks.map((c: any) => c.referrer);
    expect(referrers).toContain("https://news.example.org/article");
    expect(referrers).toContain(null);
  });

  it("AC-R7: HEAD /:code returns the same 302 and Location as GET but records NO click", async () => {
    const target = uniqueTargetUrl("head");
    const link = await createLink(target);

    const head = await request(`/${link.code}`, { method: "HEAD" });
    expect(head.status).toBe(302);
    expect(head.headers.get("location")).toBe(target);

    // Five more HEADs to make an off-by-one impossible to miss.
    for (let i = 0; i < 5; i++) await request(`/${link.code}`, { method: "HEAD" });

    const stats = await getStats(link.code);
    expect(stats.json.clickCount).toBe(0);
    expect(stats.json.clicks).toEqual([]);
  });

  it("AC-R8: GET carrying Sec-Purpose: prefetch returns 302 but records NO click", async () => {
    const target = uniqueTargetUrl("secpurpose");
    const link = await createLink(target);

    for (const value of ["prefetch", "prefetch;prerender"]) {
      const res = await request(`/${link.code}`, { headers: { "sec-purpose": value } });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(target);
    }

    const stats = await getStats(link.code);
    expect(stats.json.clickCount).toBe(0);
    expect(stats.json.clicks).toEqual([]);
  });

  it("AC-R8b: GET carrying Purpose: prefetch returns 302 but records NO click", async () => {
    const target = uniqueTargetUrl("purpose");
    const link = await createLink(target);

    const res = await request(`/${link.code}`, { headers: { purpose: "prefetch" } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(target);

    const stats = await getStats(link.code);
    expect(stats.json.clickCount).toBe(0);
  });

  it("AC-R8c: a normal GET without prefetch headers still counts (guards against over-filtering)", async () => {
    const link = await createLink(uniqueTargetUrl("normalget"));
    await request(`/${link.code}`, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
    });

    const stats = await getStats(link.code);
    expect(stats.json.clickCount).toBe(1);
  });

  it("AC-R9: an unknown code returns 404 and records no click", async () => {
    const res = await request("/zzzzzzz");
    expect(res.status).toBe(404);

    const stats = await getStats("zzzzzzz");
    expect(stats.status).toBe(404);
  });

  it("AC-R10: an expired code returns 410 and records no click", async () => {
    const link = await createLink(uniqueTargetUrl("expired"), { expiresAt: isoInFuture(1500) });

    // Counts while still live.
    expect((await request(`/${link.code}`)).status).toBe(302);

    await sleep(2500);

    const expired = await request(`/${link.code}`);
    expect(expired.status).toBe(410);
    expect(expired.headers.get("location")).toBeNull();

    const stats = await getStats(link.code);
    expect(stats.json.clickCount).toBe(1); // the pre-expiry click only
  });

  it("AC-R11: 404 from GET /:code returns an HTML body, not JSON", async () => {
    const res = await request("/qqqqqqq");

    expect(res.status).toBe(404);
    expect(res.contentType).toMatch(/text\/html/);
    expect(res.json, "404 body must not be JSON").toBeUndefined();
    expect(res.body).toMatch(/<html[\s>]/i);
    // Copy requirement: says the link does not exist and suggests checking the code.
    expect(res.body).toMatch(/(does not exist|doesn't exist|not found|no such link)/i);
    expect(res.body).toMatch(/code/i);
  });

  it("AC-R11b: 410 from GET /:code returns an HTML body stating the link has expired", async () => {
    const link = await createLink(uniqueTargetUrl("expiredhtml"), { expiresAt: isoInFuture(1500) });
    await sleep(2500);

    const res = await request(`/${link.code}`);
    expect(res.status).toBe(410);
    expect(res.contentType).toMatch(/text\/html/);
    expect(res.json, "410 body must not be JSON").toBeUndefined();
    expect(res.body).toMatch(/<html[\s>]/i);
    expect(res.body).toMatch(/expire/i);
  });

  it("AC-R11c: 410 is visibly distinct from 404 (different status AND different copy)", async () => {
    const link = await createLink(uniqueTargetUrl("distinct"), { expiresAt: isoInFuture(1500) });
    await sleep(2500);

    const gone = await request(`/${link.code}`);
    const missing = await request("/wwwwwww");

    expect(gone.status).toBe(410);
    expect(missing.status).toBe(404);
    expect(gone.body).not.toBe(missing.body);
    expect(missing.body).not.toMatch(/expire/i);
  });

  it("AC-R11d: every route other than GET /:code returns JSON errors, not HTML", async () => {
    const jsonErrorRoutes = [
      { path: "/zzzzzzz/stats", method: "GET" },
      { path: "/links", method: "POST", body: { url: "notaurl" } },
    ];

    for (const route of jsonErrorRoutes) {
      const res = await request(route.path, { method: route.method, body: (route as any).body });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(
        res.contentType,
        `${route.method} ${route.path} must return a JSON error`,
      ).toMatch(/application\/json/);
      expect(typeof res.json?.error).toBe("string");
    }
  });
});
