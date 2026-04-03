/**
 * Format a date string for display, avoiding the UTC timezone offset bug.
 *
 * Date-only strings like "2026-04-01" are parsed as UTC midnight by `new Date()`,
 * which causes them to display as the previous day in US timezones (e.g. March 31).
 * This function parses date-only strings as local dates to prevent that.
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014';
  // Date-only string (YYYY-MM-DD): parse as local date
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString();
  }
  // Full timestamp: parse normally
  return new Date(dateStr).toLocaleDateString();
}
