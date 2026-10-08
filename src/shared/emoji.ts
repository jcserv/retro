const SINGLE_EMOJI = /^\p{RGI_Emoji}$/v;
const VARIATION_SELECTOR_16 = /️/g;

export function normalizeEmoji(value: string): string {
  if (SINGLE_EMOJI.test(value)) return value;
  const stripped = value.replace(VARIATION_SELECTOR_16, "");
  return SINGLE_EMOJI.test(stripped) ? stripped : value;
}

export function isEmoji(value: string): boolean {
  return SINGLE_EMOJI.test(value);
}
