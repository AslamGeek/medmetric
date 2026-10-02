import { AppError, readSheet } from './sheets.js';
import { dashboardModel, drilldownModel } from './analytics.js';

export const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Vary': 'Authorization',
  'X-Content-Type-Options': 'nosniff'
};
export function json(body, status = 200) { return Response.json(body, { status, headers: privateHeaders }); }

function object(value, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, `${label} must be an object.`);
  return value;
}
function stringFields(input, names) {
  const result = {};
  for (const name of names) {
    if (input[name] === undefined) continue;
    if (typeof input[name] !== 'string' || input[name].length > 1000) throw new AppError(400, `Invalid ${name}.`);
    result[name] = input[name];
  }
  return result;
}
export function validateInput(input) {
  const body = object(input, 'Request');
  const f = object(body.filters, 'Filters');
  const filters = stringFields(f, ['start','end','agency','brand','product','trendProduct']);
  if (f.includeExcluded !== undefined && typeof f.includeExcluded !== 'boolean') throw new AppError(400, 'Invalid inclusion toggle.');
  filters.includeExcluded = f.includeExcluded === true;
  for (const name of ['maxUnits','minAge']) {
    if (f[name] === undefined || f[name] === null || f[name] === '') continue;
    if (typeof f[name] !== 'number' || !Number.isFinite(f[name]) || f[name] < 0) throw new AppError(400, `Invalid ${name}.`);
    filters[name] = f[name];
  }
  const r = object(body.request, 'Drill-down request');
  const request = stringFields(r, ['kind','month','productKey']);
  if (request.kind && !['product','financial','candidates'].includes(request.kind)) throw new AppError(400, 'Invalid drill-down kind.');
  if (request.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(request.month)) throw new AppError(400, 'Invalid drill-down month.');
  if (r.offset !== undefined && (!Number.isSafeInteger(r.offset) || r.offset < 0)) throw new AppError(400, 'Invalid page offset.');
  request.offset = r.offset || 0;
  return { filters, request };
}

export async function handleData(request, mode, loader = readSheet) {
  try {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new AppError(403, 'Cross-origin requests are not allowed.');
    const auth = request.headers.get('authorization') || '';
    if (!/^Bearer [A-Za-z0-9._~+\/-]{10,4096}$/.test(auth)) throw new AppError(401, 'Connect with Google to view your sales data.');
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new AppError(415, 'Send JSON data.');
    if (Number(request.headers.get('content-length')) > 16384) throw new AppError(413, 'Request is too large.');
    const raw = await request.text();
    if (raw.length > 16384) throw new AppError(413, 'Request is too large.');
    let body;
    try { body = JSON.parse(raw); } catch { throw new AppError(400, 'Request is not valid JSON.'); }
    const { filters, request: drillRequest } = validateInput(body);
    // Google checks this user's token and this sheet's ACL on every request.
    // No service account, shared data cache, write request or anonymous fallback.
    const data = await loader(auth.slice(7));
    try { return json(mode === 'drilldown' ? drilldownModel(data, filters, drillRequest) : dashboardModel(data, filters)); }
    catch (error) { throw new AppError(422, error.message); }
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (['TimeoutError','AbortError'].includes(error.name)) return json({ error: 'Google Sheets took too long to respond. Try again.' }, 504);
    return json({ error: 'Unable to load the sheet right now. Please try again.' }, 502);
  }
}
