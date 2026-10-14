import { formatInTimeZone } from 'date-fns-tz';

// Visit input timestamps represent clinic clock time. Do not parse an unzoned
// value through the device's timezone or the user's current display timezone.
export function formatLedgerTreatmentTime(value: string | null, timezone: string | undefined) {
  if (!value) return '';
  const zone = timezone || 'Recorded clinic time';
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (local) {
    const date = new Date(Date.UTC(Number(local[1]), Number(local[2]) - 1, Number(local[3]), Number(local[4]), Number(local[5])));
    return `${new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(date)} (${zone})`;
  }
  try { return `${formatInTimeZone(value, timezone || 'Asia/Manila', 'MMMM d, yyyy • h:mm a')} (${zone})`; }
  catch { return `${value} (${zone})`; }
}
