import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";
import { App } from "./app";

test("App renders the Retro heading", () => {
  expect(renderToString(<App />)).toBe("<h1>Retro</h1>");
});
