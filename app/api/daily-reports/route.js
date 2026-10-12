import {handleDailyReports} from '../../../lib/daily-server.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export function POST(request){return handleDailyReports(request);}
