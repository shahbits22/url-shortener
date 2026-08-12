import { exec } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  RESTART_CMD,
  createLink,
  getStats,
  request,
  uniqueTargetUrl,
  waitForHealthy,
} from "../helpers/client.js";

const execAsync = promisify(exec);

describe("Operational", () => {
  it("AC-O1: GET /health returns 200 and is not interpretable as a short code", async () => {
    const res = await request("/health");
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(302);
    expect(res.headers.get("location")).toBeNull();

    // Reserved paths must not behave as short codes in any casing.
    for (const path of ["/health", "/HEALTH", "/links", "/LINKS"]) {
      const r = await request(path);
      expect(r.status, `${path} must never redirect`).not.toBe(302);
    }

    // /health/stats is not a stats route for a link called "health".
    const stats = await request("/health/stats");
    expect(stats.status).toBe(404);
  });

  it("AC-O1b: reserved paths are unreachable as codes — creating a link never shadows them", async () => {
    await createLink(uniqueTargetUrl("reserved-shadow"));
    const health = await request("/health");
    expect(health.status).toBe(200);
    expect(health.headers.get("location")).toBeNull();
  });
});

// Restart persistence needs a way to restart the service from outside the suite.
// Contract: RESTART_CMD is a shell command that stops and restarts the service
// against the SAME data store and returns once the restart has been initiated.
// See tests/README.md and the QA comment on issue #1.
describe.skipIf(!RESTART_CMD)("Operational — restart persistence (requires RESTART_CMD)", () => {
  it("AC-O2: data persists across a process restart", async () => {
    const target = uniqueTargetUrl("persist");
    const link = await createLink(target);
    await request(`/${link.code}`, { headers: { referer: "https://before.example.com/" } });
    await request(`/${link.code}`);

    const before = await getStats(link.code);
    expect(before.json.clickCount).toBe(2);

    await execAsync(RESTART_CMD, { cwd: process.cwd(), timeout: 60_000 });
    await waitForHealthy();

    // The code created before the restart still redirects to the same URL.
    const redirect = await request(`/${link.code}`);
    expect(redirect.status, "link created before restart no longer redirects").toBe(302);
    expect(redirect.headers.get("location")).toBe(target);

    // And its history survived too.
    const after = await getStats(link.code);
    expect(after.status).toBe(200);
    expect(after.json.url).toBe(target);
    expect(after.json.createdAt).toBe(before.json.createdAt);
    expect(after.json.clickCount).toBe(3); // 2 before + the post-restart redirect
    expect(JSON.stringify(after.json)).toContain("before.example.com");
  });
});
