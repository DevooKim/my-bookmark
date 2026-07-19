// datetime-local inputs take local wall-clock strings (YYYY-MM-DDTHH:mm);
// Date#toISOString is UTC and would shift the shown time by the tz offset.
export function toDatetimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Split a wall-clock datetime-local string into its date (YYYY-MM-DD) and
// time (HH:mm) parts so a custom picker can drive a native date input plus
// separate 24-hour hour/minute controls (native datetime-local honors the
// OS locale's 12/24h clock, which we can't override).
export function splitDatetimeLocalValue(value: string): {
  date: string;
  time: string;
} {
  const [date = "", time = ""] = value.split("T");
  return { date, time };
}

// Recombine a date (YYYY-MM-DD) and time (HH:mm) into a datetime-local string.
// Returns "" when either part is missing so callers can treat it as unset.
export function joinDatetimeLocalValue(date: string, time: string): string {
  if (!date || !time) {
    return "";
  }
  return `${date}T${time}`;
}
