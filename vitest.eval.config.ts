import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: true,
      miniflare: {
        bindings: {
          AI_SUGGESTIONS: "on",
          EVAL_MODELS: process.env.EVAL_MODELS ?? "",
          EVAL_FIXTURES: process.env.EVAL_FIXTURES ?? "",
        },
      },
    }),
  ],
  test: {
    include: ["scripts/eval-suggestions.ts"],
    testTimeout: 15 * 60_000,
    silent: false,
    reporters: ["verbose"],
  },
});
