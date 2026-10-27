/** Calendar cutoff for recent observations, clamped to the end of shorter months. */
export function threeMonthsBefore(now: number): number {
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 3);
  const endOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, endOfMonth));
  return date.getTime();
}

export function recentObservation(time: number, now = Date.now()): boolean {
  return Number.isFinite(time) && time >= threeMonthsBefore(now) && time <= now;
}
