import { json } from '../../../lib/api.js';
import { backendConfigured } from '../../../lib/sheets.js';
export const dynamic='force-dynamic';
export function GET(){return json({configured:backendConfigured()});}
