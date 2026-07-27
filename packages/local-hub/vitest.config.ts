import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The local hub tests exercise real Git repositories, SQLite databases, and
    // temporary filesystems. Windows CI can legitimately exceed Vitest's 5s
    // default while the same operations are running concurrently.
    testTimeout: 20_000,
    hookTimeout: 15_000,
    server: {
      deps: {
        external: [/^node:/],
      },
    },
  },
});
