/** Canonical timestamp for API output: ISO-8601 UTC with milliseconds. */
export function toIso(value) {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Second-precision ISO string (matches how the Python pipeline stores timestamps, so string
 *  comparisons in SQLite behave correctly). */
export function toDbTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
