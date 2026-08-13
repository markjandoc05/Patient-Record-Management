import { formatInTimeZone } from 'date-fns-tz';

export type AppTimezoneSettings = {
  timezone?: string;
  displayName?: string;
  format?: '12h' | '24h' | string;
};

const defaultSettings: AppTimezoneSettings = {
  timezone: 'Asia/Manila',
  displayName: '(UTC+08:00) Philippine Standard Time',
  format: '12h',
};

let activeSettings: AppTimezoneSettings = defaultSettings;

export const setActiveTimezoneSettings = (settings: AppTimezoneSettings | null | undefined) => {
  activeSettings = { ...defaultSettings, ...(settings || {}) };
};

export const getActiveTimezoneSettings = () => activeSettings;

export const getActiveDatePrefix = (date: Date | string | number = new Date()) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  try {
    return formatInTimeZone(parsed, activeSettings.timezone || defaultSettings.timezone!, 'yyyy-MM-dd');
  } catch {
    return formatInTimeZone(parsed, defaultSettings.timezone!, 'yyyy-MM-dd');
  }
};

export const getActiveDateTimeInput = (date: Date | string | number = new Date()) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  try {
    return formatInTimeZone(parsed, activeSettings.timezone || defaultSettings.timezone!, "yyyy-MM-dd'T'HH:mm");
  } catch {
    return formatInTimeZone(parsed, defaultSettings.timezone!, "yyyy-MM-dd'T'HH:mm");
  }
};

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
  
  try {
    return formatInTimeZone(d, tz, formatStr);
  } catch {
    return formatInTimeZone(d, defaultSettings.timezone!, formatStr);
  }
};

export const formatActiveTimezone = (
  date: Date | string | number | null | undefined,
  formatOverride?: string
) => formatTimezone(date, activeSettings, formatOverride);
