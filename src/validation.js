export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function text(value, name, max, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new HttpError(400, `${name} must be ${min}–${max} characters.`);
  return value.trim();
}
export function id(value, name = 'ID', max = 999999999999999) {
  if (!/^[1-9]\d{0,14}$/.test(String(value)) || Number(value)>max) throw new HttpError(400, `${name} must be a positive integer within range.`);
  return String(value);
}
export function email(value) {
  const normalized = text(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new HttpError(400, 'Enter a valid campus email address.');
  return normalized;
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value,'utf8') > 72) throw new HttpError(400, 'Password must be at least 8 characters and at most 72 UTF-8 bytes.');
  return value;
}
export function integer(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new HttpError(400, `${name} must be an integer from ${min} to ${max}.`);
  return value;
}
export function deadline(value) {
  // API requires a timezone; datetime-local is converted to ISO by the browser.
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new HttpError(400,'Deadline must include a timezone.');
  const parts=value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/);
  const [year,month,day,hour,minute,second]=parts.slice(1).map(part=>Number(part || 0));
  const daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate();
  if(month<1 || month>12 || day<1 || day>daysInMonth || hour>23 || minute>59 || second>59) throw new HttpError(400,'Choose a valid calendar date and time.');
  const d = new Date(value);
  if (!Number.isFinite(d.getTime()) || d <= new Date() || d.getUTCFullYear()>9999) throw new HttpError(400, 'Choose a future deadline.');
  return d;
}
