import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./constants";

const UNBIASED_BYTE_LIMIT = 256 - (256 % ROOM_CODE_ALPHABET.length);
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function generateRoomCode(): string {
  let code = "";
  const bytes = new Uint8Array(ROOM_CODE_LENGTH * 2);
  while (code.length < ROOM_CODE_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue;
      code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
      if (code.length === ROOM_CODE_LENGTH) break;
    }
  }
  return code;
}

export function isValidRoomCode(s: string): boolean {
  return ROOM_CODE_PATTERN.test(s);
}
