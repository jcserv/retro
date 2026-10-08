const PATHS = {
  people:
    "M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 7.5a2 2 0 1 0 0-4M12 9.6c1.5.4 2.5 1.6 2.5 3.4",
  clock: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 4.5V8l2.5 1.5",
  link: "M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.9.9M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8A3 3 0 0 0 7.2 13l.9-.9",
  check: "M3 8.5 6.5 12 13 4.5",
  pencil: "M10.5 2.5l3 3L6 13H3v-3l7.5-7.5Z",
  trash: "M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  arrowRight: "M3 8h9M9 4.5 12.5 8 9 11.5",
  close: "M4 4l8 8M12 4l-8 8",
  smilePlus:
    "M14.4 9A6.5 6.5 0 1 1 7 1.6M5.5 9.5c.6.9 1.4 1.4 2.5 1.4s1.9-.5 2.5-1.4M6 6.2v.1M10 6.2v.1M12.5 1v4.5M10.25 3.25h4.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
