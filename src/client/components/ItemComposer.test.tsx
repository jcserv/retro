// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test } from "vitest";
import { IntentError } from "../lib/connection";
import type { IntentResult } from "../state/roomStore";
import { ItemComposer } from "./ItemComposer";

const FAILED: IntentResult = { ok: false, error: new IntentError("disconnected", "Offline") };

let container: HTMLElement;
let pending: { text: string; resolve: (result: IntentResult) => void }[];

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  pending = [];
  render(
    <ItemComposer
      label="New item"
      max={280}
      submitLabel="Add"
      onSubmit={(text) => new Promise((resolve) => pending.push({ text, resolve }))}
    />,
    container,
  );
});

afterEach(() => {
  render(null, container);
  container.remove();
});

function field(): HTMLTextAreaElement {
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("composer textarea missing");
  return textarea;
}

async function type(text: string) {
  await act(() => {
    field().value = text;
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressEnter() {
  await act(() => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

async function settle(index: number, result: IntentResult) {
  await act(async () => pending[index]?.resolve(result));
}

test("sends a second item while the first is still awaiting its ack", async () => {
  await type("First");
  await pressEnter();
  expect(field().value).toBe("");
  await type("Second");
  await pressEnter();

  expect(pending.map((entry) => entry.text)).toEqual(["First", "Second"]);
  expect(field().value).toBe("");
});

test("a failed send restores its text only when the box is empty", async () => {
  await type("First");
  await pressEnter();
  await type("Second");
  await pressEnter();
  await settle(1, FAILED);
  expect(field().value).toBe("Second");

  await settle(0, FAILED);
  expect(field().value).toBe("Second");
});

test("a failed send keeps text typed after it was sent", async () => {
  await type("First");
  await pressEnter();
  await type("Draft");
  await settle(0, FAILED);
  expect(field().value).toBe("Draft");
});
