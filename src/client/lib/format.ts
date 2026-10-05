const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export function textLength(text: string): number {
  return [...text.trim()].length;
}

export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "expired";
  if (ms < MINUTE_MS) return "less than 1m";
  const totalMinutes = Math.floor(ms / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function expiryTickMs(ms: number): number {
  return ms < HOUR_MS ? 5_000 : 30_000;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
