import { textLength } from "../lib/format";

export function CharCount({ text, max, id }: { text: string; max: number; id?: string }) {
  const length = textLength(text);
  return (
    <span id={id} class="field-hint" data-over={length > max ? "true" : undefined}>
      {length}/{max}
    </span>
  );
}
