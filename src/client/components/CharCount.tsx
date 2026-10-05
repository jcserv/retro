import { codePointLength } from "../lib/text";

export function CharCount({ text, max, id }: { text: string; max: number; id?: string }) {
  const length = codePointLength(text.trim());
  return (
    <span id={id} class="field-hint" data-over={length > max ? "true" : undefined}>
      {length}/{max}
    </span>
  );
}

export function fitsLimit(text: string, max: number): boolean {
  const length = codePointLength(text.trim());
  return length > 0 && length <= max;
}
