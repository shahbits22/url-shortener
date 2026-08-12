import { describe, expect, it } from "vitest";
import {
  SHORT_CODE_RE,
  TEST_HOOKS_ENABLED,
  request,
  uniqueTargetUrl,
} from "../helpers/client.js";

/**
 * Collision retry and reserved-code regeneration are internal to the generator and
 * produce no externally distinguishable behaviour: a conforming and a broken
 * implementation both answer 201 with a 7-char code on every ordinary request.
 * The spec itself acknowledges this — "testable by seeding the generator to collide
 * once" — but names no seam.
 *
 * Rather than guessing at internals, QA requires ONE documented, test-only hook and
 * tests through it. This is spec gap SG-1, raised on issue #1.
 *
 *   Enabled only when the service is started with ENABLE_TEST_HOOKS=1.
 *   POST /__test__/next-codes  {"codes": ["ab3de9f", ...]}  -> 204
 *       The next N codes the generator returns are exactly these, in order,
 *       BEFORE the normal collision/reserved checks run. After the queue drains,
 *       generation reverts to random.
 *   DELETE /__test__/next-codes -> 204   (clears the queue)
 *
 * Run these with TEST_HOOKS=1 on the suite side.
 */

async function seedCodes(codes: string[]): Promise<void> {
  const res = await request("/__test__/next-codes", { method: "POST", body: { codes } });
  if (res.status !== 204 && res.status !== 200) {
    throw new Error(`test hook POST /__test__/next-codes returned ${res.status}: ${res.body}`);
  }
}

async function clearCodes(): Promise<void> {
  await request("/__test__/next-codes", { method: "DELETE" });
}

describe.skipIf(!TEST_HOOKS_ENABLED)(
  "Code generation internals (requires ENABLE_TEST_HOOKS=1 + TEST_HOOKS=1)",
  () => {
    it("AC-C14: generation retries on collision — the second request still gets 201 and a unique code", async () => {
      await clearCodes();
      // Generator emits 'aaaaaaa' twice; the second emission collides with the
      // link created by the first request and must be discarded in favour of 'bbbbbbb'.
      await seedCodes(["aaaaaaa", "aaaaaaa", "bbbbbbb"]);

      const firstTarget = uniqueTargetUrl("collide-1");
      const secondTarget = uniqueTargetUrl("collide-2");

      const first = await request("/links", { method: "POST", body: { url: firstTarget } });
      expect(first.status).toBe(201);
      expect(first.json.code).toBe("aaaaaaa");

      const second = await request("/links", { method: "POST", body: { url: secondTarget } });
      expect(second.status, "collision must be retried, not surfaced as an error").toBe(201);
      expect(second.json.code).not.toBe("aaaaaaa");
      expect(second.json.code).toBe("bbbbbbb");
      expect(second.json.code).toMatch(SHORT_CODE_RE);

      // Critically: the first link must NOT have been overwritten.
      const firstRedirect = await request("/aaaaaaa");
      expect(firstRedirect.status).toBe(302);
      expect(firstRedirect.headers.get("location")).toBe(firstTarget);

      const secondRedirect = await request("/bbbbbbb");
      expect(secondRedirect.status).toBe(302);
      expect(secondRedirect.headers.get("location")).toBe(secondTarget);

      await clearCodes();
    });

    it("AC-C12b: generation regenerates when it produces a reserved path (links, health)", async () => {
      await clearCodes();
      await seedCodes(["links", "health", "ccccccc"]);

      const res = await request("/links", {
        method: "POST",
        body: { url: uniqueTargetUrl("reserved-gen") },
      });

      expect(res.status).toBe(201);
      expect(res.json.code).not.toBe("links");
      expect(res.json.code).not.toBe("health");
      expect(res.json.code).toBe("ccccccc");

      // /health still answers as the health endpoint.
      expect((await request("/health")).status).toBe(200);

      await clearCodes();
    });
  },
);

describe.skipIf(TEST_HOOKS_ENABLED)("Test hooks are not exposed by default", () => {
  it("SEC-1: /__test__/next-codes is unavailable unless ENABLE_TEST_HOOKS=1", async () => {
    const res = await request("/__test__/next-codes", {
      method: "POST",
      body: { codes: ["ddddddd"] },
    });
    expect(res.status, "test hook must not be mounted in a default start").toBe(404);
  });
});
