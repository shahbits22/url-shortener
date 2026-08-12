import { defineConfig } from "vitest/config";

// The suite talks to ONE shared running service over HTTP. Several specs assert
// exact per-link click counts and one spec restarts the process, so files are run
// sequentially in a single worker. Individual links are never shared between tests.
export default defineConfig({
  test: {
    globals: true,
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./helpers/setup.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ["verbose"],
  },
});
