import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Server integration tests create real SQLite state and HTTP listeners.
    // Windows CI can exceed Vitest's 5s default under concurrent package load.
    testTimeout: 20_000,
    hookTimeout: 15_000,
  },
});
