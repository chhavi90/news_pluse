const timeOpts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
const dayOpts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };

export const formatClock = (iso: string | Date) => new Date(iso).toLocaleTimeString(undefined, timeOpts);
export const formatDay = (iso: string | Date) => new Date(iso).toLocaleDateString(undefined, dayOpts);
export const formatStamp = (iso: string | Date) => `${formatDay(iso)}, ${formatClock(iso)}`;

export function formatDuration(minutes: number): string {
  if (minutes < 1) return "a single moment";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 48) return m && h < 10 ? `${h} h ${m} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export function formatRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (e.getTime() - s.getTime() < 60_000) return formatStamp(s);
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay ? `${formatDay(s)}, ${formatClock(s)} – ${formatClock(e)}` : `${formatStamp(s)} – ${formatStamp(e)}`;
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 45) return "just now";
  const mins = Math.round(diff / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
