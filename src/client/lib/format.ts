const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export function textLength(text: string): number {
  return [...text.trim()].length;
}

const DUE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDueDate(isoDate: string, now = new Date()): string {
  const match = DUE_DATE.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "expired";
  if (ms < MINUTE_MS) return "less than 1m";
  const totalMinutes = Math.floor(ms / MINUTE_MS);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function expiryTickMs(ms: number): number {
  return ms < HOUR_MS ? 5_000 : 30_000;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
