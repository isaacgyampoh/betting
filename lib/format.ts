// Display formatting shared by server and client. Ghana uses GMT all year (Africa/Accra).
const TZ = "Africa/Accra";

const kickoffFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatKickoff(iso: string): string {
  const parts = Object.fromEntries(kickoffFmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} GMT`;
}

export function formatOdds(odds: number | null): string {
  if (odds === null) return "–";
  return odds >= 1000 ? odds.toLocaleString("en-GH", { maximumFractionDigits: 0 }) : odds.toFixed(2);
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}
