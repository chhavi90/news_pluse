/** Error carrying an HTTP status - anything else becomes a 500. */
export class HttpError extends Error {
  constructor(status, message, code = 'error', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message) => new HttpError(400, message, 'bad_request');
export const notFound = (message) => new HttpError(404, message, 'not_found');

/** Wrap async route handlers so rejections reach the error middleware (Express 4 & 5). */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Read an integer query parameter with bounds; throws 400 when it is malformed. */
export function intParam(value, name, { min, max, fallback }) {
  if (value === undefined || value === '') return fallback;
  if (!/^-?\d+$/.test(String(value))) throw badRequest(`"${name}" must be an integer`);
  const n = Number(value);
  if (n < min || n > max) throw badRequest(`"${name}" must be between ${min} and ${max}`);
  return n;
}

/** Comma separated list -> array of trimmed, non-empty, de-duplicated strings. */
export function listParam(value, name, { maxItems = 25, maxLength = 80 } = {}) {
  if (value === undefined || value === '') return [];
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const items = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  if (items.length > maxItems) throw badRequest(`"${name}" accepts at most ${maxItems} values`);
  if (items.some((s) => s.length > maxLength)) throw badRequest(`"${name}" contains a value that is too long`);
  return items;
}

/** ISO-8601 date/time query parameter -> Date (or undefined). */
export function dateParam(value, name) {
  if (value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw badRequest(`"${name}" must be an ISO-8601 date/time`);
  return d;
}

export function enumParam(value, name, allowed, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!allowed.includes(value)) throw badRequest(`"${name}" must be one of: ${allowed.join(', ')}`);
  return value;
}

/** Row ids are positive 32-bit integers. */
export function idParam(value, name = 'id') {
  if (!/^\d{1,10}$/.test(String(value)) || Number(value) < 1 || Number(value) > 2147483647) {
    throw badRequest(`"${name}" must be a positive integer`);
  }
  return Number(value);
}
