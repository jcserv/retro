export function codePointLength(text: string): number {
  let length = 0;
  for (const _ of text) length += 1;
  return length;
}
