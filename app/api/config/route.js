import { json } from '../../../lib/api.js';
export const dynamic = 'force-dynamic';
export function GET() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  return json({ clientId: /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) ? clientId : '', configured: /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) });
}
