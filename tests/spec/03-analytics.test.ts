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

describe("Analytics — GET /:code/stats", () => {
  it("AC-A1: an existing code returns 200 with all eight documented fields", async () => {
    const link = await createLink(uniqueTargetUrl("shape"), { expiresAt: isoInFuture(3_600_000) });
    await request(`/${link.code}`, { headers: { referer: "https://a.example.com/" } });

    const res = await getStats(link.code);
    expect(res.status).toBe(200);
    expect(res.contentType).toMatch(/application\/json/);

    for (const field of [
      "code",
      "url",
      "createdAt",
      "expiresAt",
      "clickCount",
      "referrers",
      "clicks",
      "clicksTruncated",
    ]) {
      expect(res.json, `stats response is missing '${field}'`).toHaveProperty(field);
    }

    expect(res.json.code.toLowerCase()).toBe(link.code.toLowerCase());
    expect(res.json.url).toBe(link.url);
    expect(typeof res.json.clickCount).toBe("number");
    expect(Array.isArray(res.json.referrers)).toBe(true);
    expect(Array.isArray(res.json.clicks)).toBe(true);
    expect(typeof res.json.clicksTruncated).toBe("boolean");
  });

  it("AC-A2: referrers aggregate across all clicks, sorted by count descending, null for direct", async () => {
    const link = await createLink(uniqueTargetUrl("referrers"));

    const a = "https://a.example.com/page";
    const b = "https://b.example.com/page";
    for (let i = 0; i < 3; i++) await request(`/${link.code}`, { headers: { referer: a } });
    for (let i = 0; i < 2; i++) await request(`/${link.code}`, { headers: { referer: b } });
    await request(`/${link.code}`); // direct

    const res = await getStats(link.code);
    expect(res.json.clickCount).toBe(6);

    const referrers = res.json.referrers as Array<{ referrer: string | null; count: number }>;
    expect(referrers).toHaveLength(3);

    // Sorted by count descending.
    const counts = referrers.map((r) => r.count);
    expect(counts).toEqual([...counts].sort((x, y) => y - x));

    const byReferrer = new Map(referrers.map((r) => [r.referrer, r.count]));
    expect(byReferrer.get(a)).toBe(3);
    expect(byReferrer.get(b)).toBe(2);

    // Direct traffic is null, never the string "direct".
    expect(byReferrer.has(null)).toBe(true);
    expect(byReferrer.get(null)).toBe(1);
    expect(referrers.some((r) => r.referrer === "direct")).toBe(false);

    // Every entry has exactly the documented shape.
    for (const entry of referrers) {
      expect(Object.keys(entry).sort()).toEqual(["count", "referrer"]);
      expect(entry.referrer === null || typeof entry.referrer === "string").toBe(true);
      expect(Number.isInteger(entry.count)).toBe(true);
    }
  });

  it("AC-A3: clicks holds {timestamp, referrer} entries, newest first", async () => {
    const link = await createLink(uniqueTargetUrl("order"));

    for (let i = 0; i < 5; i++) {
      await request(`/${link.code}`, { headers: { referer: `https://r.example.com/${i}` } });
      await sleep(5); // keep millisecond timestamps distinguishable
    }

    const res = await getStats(link.code);
    const clicks = res.json.clicks as Array<{ timestamp: string; referrer: string | null }>;
    expect(clicks).toHaveLength(5);

    for (const click of clicks) {
      expect(Object.keys(click).sort()).toEqual(["referrer", "timestamp"]);
      expectUtcIso(click.timestamp);
    }

    // Newest first: referrer 4 leads, referrer 0 trails.
    expect(clicks[0].referrer).toBe("https://r.example.com/4");
    expect(clicks[4].referrer).toBe("https://r.example.com/0");

    const times = clicks.map((c) => Date.parse(c.timestamp));
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });

  it("AC-A4: clicks is capped at the 100 most recent and clicksTruncated flips to true past 100", async () => {
    const link = await createLink(uniqueTargetUrl("truncate"));

    // 105 sequential clicks so the "most recent 100" set is deterministic.
    for (let i = 0; i < 105; i++) {
      await request(`/${link.code}`, { headers: { referer: `https://r.example.com/${i}` } });
    }

    const res = await getStats(link.code);
    expect(res.json.clickCount).toBe(105);
    expect(res.json.clicks).toHaveLength(100);
    expect(res.json.clicksTruncated).toBe(true);

    const referrers = (res.json.clicks as Array<{ referrer: string | null }>).map(
      (c) => c.referrer,
    );
    // The most recent 100 are clicks 5..104; the first five are dropped.
    expect(referrers[0]).toBe("https://r.example.com/104");
    expect(referrers[99]).toBe("https://r.example.com/5");
    for (let i = 0; i < 5; i++) {
      expect(referrers).not.toContain(`https://r.example.com/${i}`);
    }

    // referrers aggregate over ALL clicks, not just the retained 100.
    const totalAggregated = (res.json.referrers as Array<{ count: number }>).reduce(
      (sum, r) => sum + r.count,
      0,
    );
    expect(totalAggregated).toBe(105);
  });

  it("AC-A4b: clicksTruncated is false at exactly 100 clicks and below", async () => {
    const link = await createLink(uniqueTargetUrl("notruncate"));
    for (let i = 0; i < 100; i++) await request(`/${link.code}`);

    const res = await getStats(link.code);
    expect(res.json.clickCount).toBe(100);
    expect(res.json.clicks).toHaveLength(100);
    expect(res.json.clicksTruncated).toBe(false);
  });

  it("AC-A5: every timestamp in every response is ISO 8601 UTC with a trailing Z", async () => {
    const expiresAt = isoInFuture(3_600_000);
    const created = await request("/links", {
      method: "POST",
      body: { url: uniqueTargetUrl("timestamps"), expiresAt },
    });
    expect(created.status).toBe(201);
    expectUtcIso(created.json.createdAt);
    expectUtcIso(created.json.expiresAt);

    await request(`/${created.json.code}`);
    const stats = await getStats(created.json.code);

    expectUtcIso(stats.json.createdAt);
    expectUtcIso(stats.json.expiresAt);
    for (const click of stats.json.clicks) expectUtcIso(click.timestamp);

    // No offset form anywhere in the payload.
    expect(JSON.stringify(stats.json)).not.toMatch(/\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}/);
  });

  it("AC-A6: a code with zero clicks returns 200 with the documented empty state, not 404", async () => {
    const link = await createLink(uniqueTargetUrl("empty"));

    const res = await getStats(link.code);
    expect(res.status).toBe(200);
    expect(res.json.clickCount).toBe(0);
    expect(res.json.referrers).toEqual([]);
    expect(res.json.clicks).toEqual([]);
    expect(res.json.clicksTruncated).toBe(false);
    expect(res.json.url).toBe(link.url);
    expectUtcIso(res.json.createdAt);
  });

  it("AC-A7: stats for an unknown code returns 404 with a JSON error body", async () => {
    for (const code of ["yyyyyyy", "nope", "0000000"]) {
      const res = await getStats(code);
      expect(res.status, `expected 404 for /${code}/stats`).toBe(404);
      expect(res.contentType).toMatch(/application\/json/);
      expect(typeof res.json?.error).toBe("string");
    }
  });

  it("AC-A8: stats for an expired code returns 200 with its full history", async () => {
    const link = await createLink(uniqueTargetUrl("expiredstats"), {
      expiresAt: isoInFuture(1500),
    });
    await request(`/${link.code}`, { headers: { referer: "https://pre.example.com/" } });
    await request(`/${link.code}`);

    await sleep(2500);
    expect((await request(`/${link.code}`)).status).toBe(410);

    const res = await getStats(link.code);
    expect(res.status).toBe(200);
    expect(res.json.clickCount).toBe(2);
    expect(res.json.clicks).toHaveLength(2);
    expectUtcIso(res.json.expiresAt);
    expect(Date.parse(res.json.expiresAt)).toBeLessThan(Date.now());
  });

  it("AC-A9: requests that returned 404 or 410 never appear in any code's clicks", async () => {
    const live = await createLink(uniqueTargetUrl("noleak"));
    const expiring = await createLink(uniqueTargetUrl("noleak-expiring"), {
      expiresAt: isoInFuture(1500),
    });

    await sleep(2500);

    // Traffic that must never be recorded anywhere.
    await request("/vvvvvvv", { headers: { referer: "https://ghost.example.com/" } });
    await request(`/${expiring.code}`, { headers: { referer: "https://ghost.example.com/" } });
    await request(`/${live.code}/not-stats`, { headers: { referer: "https://ghost.example.com/" } });

    const liveStats = await getStats(live.code);
    expect(liveStats.json.clickCount).toBe(0);
    expect(liveStats.json.clicks).toEqual([]);

    const expiringStats = await getStats(expiring.code);
    expect(expiringStats.json.clickCount).toBe(0);
    expect(expiringStats.json.clicks).toEqual([]);
    expect(JSON.stringify(expiringStats.json)).not.toContain("ghost.example.com");
  });
});
