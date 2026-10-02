import { handleData } from '../../../lib/api.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export function POST(request) { return handleData(request, 'dashboard'); }
