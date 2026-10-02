import { HEADERS, prepareData } from './analytics.js';

// The server reads only this spreadsheet. A client cannot choose another resource.
export const SPREADSHEET_ID = '1dYodW1QJQBAXvFQph-zhA_iVIjmt_YFUFlbnuZhpluE';
const ranges = ['MONTHLY_TOTALS!A:N', 'SALES_RAW!A:S', 'PRODUCT_CONFIG!A:L'];

export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function tableRecords(values, name) {
  if (!Array.isArray(values) || !values.length) throw new AppError(422, `${name} must contain its header row.`);
  const headers = values[0].map(v => String(v ?? '').trim());
  const missing = HEADERS[name].filter(h => !headers.includes(h));
  if (missing.length) throw new AppError(422, `${name} is missing headers: ${missing.join(', ')}`);
  if (new Set(headers).size !== headers.length) throw new AppError(422, `${name} contains duplicate headers.`);
  return values.slice(1).map((row, i) => {
    const record = { _row: i + 2 };
    HEADERS[name].forEach(h => { record[h] = row[headers.indexOf(h)] ?? ''; });
    return record;
  }).filter(row => HEADERS[name].some(h => String(row[h]).trim() !== ''));
}

export async function readSheet(accessToken, fetcher = fetch) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet`);
  ranges.forEach(range => url.searchParams.append('ranges', range));
  url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
  url.searchParams.set('dateTimeRenderOption', 'SERIAL_NUMBER');
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store', signal: AbortSignal.timeout(20000)
  });
  if (response.status === 401) throw new AppError(401, 'Your Google connection expired. Connect with Google again.');
  if (response.status === 403) throw new AppError(403, 'Google denied access. Use an account with permission to this sheet, grant read-only Sheets access, and ensure Google Sheets API is enabled in the OAuth project.');
  if (response.status === 404) throw new AppError(403, 'This Google account cannot find the configured spreadsheet. Check its existing sheet access.');
  if (response.status === 429) throw new AppError(429, 'Google Sheets is temporarily rate-limiting requests. Wait a moment, then refresh.');
  if (response.status === 400) throw new AppError(422, 'The expected spreadsheet tabs could not be read. Check MONTHLY_TOTALS, SALES_RAW and PRODUCT_CONFIG.');
  if (!response.ok) throw new AppError(502, 'Google Sheets is temporarily unavailable. Please try again.');
  const body = await response.json();
  if (!Array.isArray(body.valueRanges) || body.valueRanges.length !== 3) throw new AppError(502, 'Google Sheets returned an incomplete response.');
  const tables = body.valueRanges.map((table, i) => tableRecords(table.values, ranges[i].split('!')[0]));
  // Serial dates preserve spreadsheet-local calendar days; no server timezone conversion.
  try { return prepareData(...tables, 'Etc/UTC'); }
  catch (error) { throw new AppError(422, error.message); }
}
