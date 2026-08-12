import { BASE_URL, request } from "./client.js";

// Fail fast, and loudly, if the service under test is not running. Without this
// every single test fails with an opaque fetch error.
export async function setup(): Promise<void> {
  try {
    const res = await request("/health");
    if (res.status !== 200) {
      throw new Error(`GET /health returned ${res.status}`);
    }
  } catch (err) {
    throw new Error(
      `\n\nCannot reach the service under test at ${BASE_URL}.\n` +
        `Start it first (from the repo root: npm ci && npm run build && npm start),\n` +
        `or point the suite elsewhere with BASE_URL=... npm test.\n` +
        `Underlying error: ${String(err)}\n`,
    );
  }
}
