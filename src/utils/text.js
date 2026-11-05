/** Shared text helpers used by catalogue and salt resolution. */
export function cleanDisplay(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim().replace(/\s+/g, ' ');
}

export function normalizeKey(value) {
  return cleanDisplay(value).toUpperCase();
}
