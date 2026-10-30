const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${nf.format(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${nf.format(mb)} MB`;
  return `${nf.format(mb / 1024)} GB`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"] as const;

export function formatDateID(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ""} ${d.getFullYear()}`;
}

export function clockNow(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

let counter = 0;
export function uid(): string {
  counter += 1;
  return `msg-${Date.now().toString(36)}-${counter}`;
}

/** 0.7 -> "0,7" (desimal Indonesia) */
export function decimalID(n: number): string {
  return String(n).replace(".", ",");
}
