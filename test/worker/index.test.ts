import { exports } from "cloudflare:workers";
import { expect, test } from "vitest";

test("unknown API routes return 404", async () => {
  const response = await exports.default.fetch("https://example.com/api/nope");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
});
