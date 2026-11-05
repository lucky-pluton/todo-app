export const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export const commentDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDateTime(isoString: string): string | null {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return dateTimeFormatter.format(date);
}
