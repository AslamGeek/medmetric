import { createHmac, randomUUID } from 'node:crypto';
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


export function backendConfigured() {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(process.env.APPS_SCRIPT_URL || '') && (process.env.MEDMETRIC_BACKEND_SECRET || '').length>=32;
}
export async function readSheet(fetcher=fetch) {
  if(!backendConfigured())throw new AppError(503,'The data connection is being configured. Please try again shortly.');
  const payload=JSON.stringify({action:'read',timestamp:Date.now(),nonce:randomUUID()});
  const signature=createHmac('sha256',process.env.MEDMETRIC_BACKEND_SECRET).update(payload).digest('hex');
  const response=await fetcher(process.env.APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature}),cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new AppError(502,'The data connection is temporarily unavailable.');
  let body;
  try {body=await response.json();} catch {throw new AppError(502,'The data connection returned an unexpected response.');}
  if(!body.ok || !Array.isArray(body.valueRanges) || body.valueRanges.length!==3)throw new AppError(502,'The data connection could not read your spreadsheet.');
  const tables=body.valueRanges.map((table,i)=>tableRecords(table.values,ranges[i].split('!')[0]));
  try {return prepareData(...tables,'Etc/UTC');} catch(error){throw new AppError(422,error.message);}
}
