const BASE_MS = 30_000;
const MAX_MS = 300_000;

export function visibilityForAttempt(attempt: number): number {
  const exponential = BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(exponential, MAX_MS);
  return Math.floor(capped / 1000);
}