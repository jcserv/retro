import { expect, test } from "vitest";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./constants";
import { generateRoomCode, isValidRoomCode } from "./roomCode";

test("generated codes have the right length and use only the alphabet", () => {
  for (let i = 0; i < 1000; i++) {
    const code = generateRoomCode();
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(isValidRoomCode(code)).toBe(true);
  }
});

test("generated characters are roughly uniform over the alphabet", () => {
  const counts = new Map<string, number>();
  const samples = 20_000;
  for (let i = 0; i < samples; i++) {
    for (const ch of generateRoomCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  const expected = (samples * ROOM_CODE_LENGTH) / ROOM_CODE_ALPHABET.length;
  expect(counts.size).toBe(ROOM_CODE_ALPHABET.length);
  for (const count of counts.values()) {
    expect(Math.abs(count - expected) / expected).toBeLessThan(0.1);
  }
});

test.each([
  ["ABC234", true],
  ["ZZZ999", true],
  ["abc234", false],
  ["ABC23", false],
  ["ABC2345", false],
  ["ABC10O", false],
  ["ABCIL2", false],
  ["", false],
  ["ABC 23", false],
])("isValidRoomCode(%j) is %s", (code, valid) => {
  expect(isValidRoomCode(code)).toBe(valid);
});
