import { cloudflare } from "@cloudflare/vite-plugin";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  const aiSuggestions = process.env.AI_SUGGESTIONS ?? "fake";
  return {
    plugins: [
      preact(),
      cloudflare(
        command === "serve"
          ? {
              remoteBindings: aiSuggestions === "on",
              persistState: process.env.E2E !== "1",
              config: { vars: { AI_SUGGESTIONS: aiSuggestions } },
            }
          : {},
      ),
      {
        name: "worker-deps",
        configEnvironment: (name) =>
          name === "client" ? undefined : { optimizeDeps: { include: ["partial-json"] } },
      },
    ],
  };
});
