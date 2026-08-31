import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests hit live registries; run them with `npm run test:live`.
    include: ["test/*.test.ts"],
  },
});
