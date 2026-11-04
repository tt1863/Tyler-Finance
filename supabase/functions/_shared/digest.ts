// What to tell someone in their daily notification. Pure logic shared by the
// push server function and the app's tests. The app does the budget math and
// uploads a PushSummary; the server only decides when to send what.

/** Uploaded by the app whenever the budget changes (one per user). */
export interface PushSummary {
  currency: string;
  /** Scheduled transactions over the next two weeks. */
  bills: { date: string; payee: string; amount: number }[];
  /** Categories overspent this month; key = "<month>:<categoryId>". */
  overspent: { key: string; name: string; amount: number }[];
  /** Transactions waiting for a category (or for review). */
  needsCategory: number;
  readyToAssign: number;
  /** Spending over the last 7 days, in cents (positive). */
  weekSpent: number;
}

export interface PushPrefs {
  bills: boolean;
  overspent: boolean;
  review: boolean;
  weekly: boolean;
}

export const DEFAULT_PREFS: PushPrefs = { bills: true, overspent: true, review: true, weekly: false };

/** Per-device delivery state, so the same thing isn't sent twice. */
export interface DigestMemory {
  /** Local date the last daily check ran. */
  lastDigest?: string;
  /** Overspent keys already mentioned. */
  overspent?: string[];
  /** Needs-category count last mentioned. */
  review?: number;
}

export interface Message {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Local date ("2026-11-04"), hour and weekday (0 = Sunday) in a time zone. */
export function localTime(now: Date, timeZone: string): { date: string; hour: number; weekday: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }).formatToParts(now);
  } catch {
    return localTime(now, 'UTC');
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, weekday: days.indexOf(get('weekday')) };
}

const nextDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
};

export function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return (cents / 100).toFixed(2);
  }
}

/**
 * The daily check for one device: at its chosen local hour, once a day,
 * say what's worth knowing. Returns the message (if any) and what to remember.
 */
export function dailyDigest(
  summary: PushSummary | null,
  prefs: PushPrefs,
  hour: number,
  timeZone: string,
  memory: DigestMemory,
  now: Date,
): { message: Message | null; memory: DigestMemory } | null {
  const local = localTime(now, timeZone);
  if (local.hour !== hour || memory.lastDigest === local.date) return null;
  const next: DigestMemory = { ...memory, lastDigest: local.date };
  if (!summary) return { message: null, memory: next };

  const lines: string[] = [];
  let url = '#/budget';
  const m = (c: number) => money(c, summary.currency);

  if (prefs.bills) {
    const tomorrow = nextDay(local.date);
    const due = summary.bills.filter((b) => b.date === tomorrow);
    if (due.length) {
      const list = due.map((b) => `${b.payee || 'Scheduled'} ${m(Math.abs(b.amount))}`).join(', ');
      lines.push(`Due tomorrow: ${list}`);
      url = '#/calendar';
    }
  }

  // Only categories that weren't overspent last time are news.
  const overspentNow = summary.overspent.map((o) => o.key);
  if (prefs.overspent) {
    const seen = new Set(memory.overspent ?? []);
    const fresh = summary.overspent.filter((o) => !seen.has(o.key));
    if (fresh.length) {
      lines.push(`Overspent: ${fresh.map((o) => `${o.name} (${m(Math.abs(o.amount))})`).join(', ')}`);
    }
  }
  next.overspent = overspentNow;

  if (prefs.review) {
    if (summary.needsCategory > 0 && summary.needsCategory > (memory.review ?? 0)) {
      lines.push(`${summary.needsCategory} transaction${summary.needsCategory === 1 ? ' needs' : 's need'} a category`);
      if (lines.length === 1) url = '#/accounts/all/review';
    }
  }
  next.review = summary.needsCategory;

  if (prefs.weekly && local.weekday === 0) {
    lines.push(`This week you spent ${m(summary.weekSpent)}. Ready to Assign: ${m(summary.readyToAssign)}`);
  }

  if (!lines.length) return { message: null, memory: next };
  return {
    message: { title: 'Tyler Finance', body: lines.join('\n'), url, tag: `digest-${local.date}` },
    memory: next,
  };
}
