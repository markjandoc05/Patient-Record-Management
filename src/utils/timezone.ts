import { formatInTimeZone } from 'date-fns-tz';

export const formatTimezone = (
  date: Date | string | number | null | undefined,
  timezoneSettings: any,
  formatOverride?: string
) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const tz = timezoneSettings?.timezone || 'Asia/Manila';
  const formatStr = formatOverride || (timezoneSettings?.format === '24h' ? 'd MMM yyyy • HH:mm' : 'MMMM d, yyyy • h:mm a');
  
  return formatInTimeZone(d, tz, formatStr);
};
