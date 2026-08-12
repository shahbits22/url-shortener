import { describe, expect, it } from "vitest";
import { createLink, getStats, request, uniqueTargetUrl } from "../helpers/client.js";

describe("Concurrency — no lost updates on the click counter", () => {
  it("AC-R12: 50 simultaneous GET /:code requests yield a clickCount of exactly 50", async () => {
    const target = uniqueTargetUrl("concurrent");
    const link = await createLink(target);

    // All 50 requests are issued before any is awaited — genuinely simultaneous.
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        request(`/${link.code}`, { headers: { referer: `https://c.example.com/${i % 5}` } }),
      ),
    );

    expect(responses).toHaveLength(50);
    for (const res of responses) {
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(target);
    }

    const stats = await getStats(link.code);
    expect(stats.json.clickCount, "lost update: clickCount must be exactly 50").toBe(50);
    expect(stats.json.clicks).toHaveLength(50);
    expect(stats.json.clicksTruncated).toBe(false);

    // The referrer breakdown must also total 50 — 5 distinct referrers, 10 each.
    const referrers = stats.json.referrers as Array<{ referrer: string | null; count: number }>;
    expect(referrers.reduce((sum, r) => sum + r.count, 0)).toBe(50);
    for (const entry of referrers) expect(entry.count).toBe(10);
  });

  it("AC-R12b: concurrent clicks across mixed request shapes count only the qualifying ones", async () => {
    const link = await createLink(uniqueTargetUrl("mixed-concurrent"));

    await Promise.all([
      ...Array.from({ length: 20 }, () => request(`/${link.code}`)), // counted
      ...Array.from({ length: 15 }, () => request(`/${link.code}`, { method: "HEAD" })), // not counted
      ...Array.from({ length: 15 }, () =>
        request(`/${link.code}`, { headers: { "sec-purpose": "prefetch" } }),
      ), // not counted
    ]);

    const stats = await getStats(link.code);
    expect(stats.json.clickCount).toBe(20);
    expect(stats.json.clicks).toHaveLength(20);
  });

  it("AC-C13: 25 simultaneous POST /links requests all succeed with distinct codes", async () => {
    const responses = await Promise.all(
      Array.from({ length: 25 }, () =>
        request("/links", { method: "POST", body: { url: uniqueTargetUrl("concurrent-create") } }),
      ),
    );

    const codes = new Set<string>();
    for (const res of responses) {
      expect(res.status).toBe(201);
      codes.add(res.json.code);
    }
    expect(codes.size, "two concurrent creates were issued the same code").toBe(25);
  });
});
