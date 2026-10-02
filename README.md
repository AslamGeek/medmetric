# MedMetric

One project: Next.js on Vercel, with Google Sheets read through apps-script/Code.gs.

Edit charts in components/ and calculations in lib/analytics.js. Double-click Commit-and-Push.cmd to publish app changes. The publisher uses this folder directly. Backend changes require updating Code.gs in the existing Apps Script project and its existing deployment.

The dashboard opens directly, without login. Anyone with the website URL can read the displayed sales data. Vercel uses APPS_SCRIPT_URL and MEDMETRIC_BACKEND_SECRET; Apps Script stores the same backend secret as a Script Property. The backend secret stays on the servers. Never commit .env.local.

Code.gs accepts signed, time-limited POST requests, reads only the three fixed source tabs, and never writes to the spreadsheet. Its public GET response contains only a service status. The web app deployment runs as its owner; public endpoint reachability does not bypass request authentication.

Use Node.js 22 or newer. npm ci, npm test, npm run build. No Google OAuth client ID or client secret is used.
