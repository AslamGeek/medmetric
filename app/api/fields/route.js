import {handleFields} from '../../../lib/field-server.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export function POST(request){return handleFields(request);}
