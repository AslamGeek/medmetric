import {handleVisits} from '../../../lib/visit-server.js';
export const runtime='nodejs';
export const maxDuration=60;
export function POST(request){return handleVisits(request);}
