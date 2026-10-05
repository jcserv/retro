import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/client/**/*.test.{ts,tsx}", "src/shared/**/*.test.ts"],
  },
});
