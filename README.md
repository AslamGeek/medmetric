# MedMetric

One project: Next.js on Vercel, with Google Sheets read through apps-script/Code.gs.

Overview, Products and Inventory are separate views. Selecting a product from a filter, catalog, ranking or inventory row opens a dedicated product analysis page. It shows that product's unit sales, receipts, closing stock, monthly sales by agency, agency comparisons, three-month trends and stock allocation signals. Product context survives month and agency changes, including selections with no observations. Financial summaries remain in Overview; product insights use only that product's observations, with full-month coverage required for growth comparisons.

Product charts show monthly Restocked vs Sold bars separately for each agency, plus month-end stock unit lines comparing agencies. Every chart has top-right Chart/Table buttons for its exact plotted values. Missing observations stay gaps or —; actual zero values remain zero. Chart and month-table clicks open the corresponding source rows, scoped to the agency when applicable.

Agency comparison bars share one value scale. Product totals require observations for each selected agency and month, and agency-share insights require comparable full-month coverage. Idle-product insights aggregate aliases by SKU first. Three-month patterns stay within the chart's displayed period. Each product chart has a takeaway using its plotted values, with partial coverage visible in tooltips and tables. The loaded timestamp includes its date so saved snapshots remain identifiable.

The browser loads one snapshot and saves it locally. Filters, charts, source-row drilldowns and page reloads reuse that snapshot until Refresh data is clicked. A failed refresh preserves the previous snapshot. If browser storage is blocked or cleared, the next page load must fetch data again. The server shares concurrent reads and caches successful snapshots for one minute; Refresh data bypasses that cache. No Apps Script update is required for these frontend changes.

Edit charts in components/ and calculations in lib/analytics.js. Double-click Commit-and-Push.cmd to publish app changes. The publisher uses this folder directly. Backend changes require updating Code.gs in the existing Apps Script project and its existing deployment.

The dashboard opens directly, without login. Anyone with the website URL can read the displayed sales data. Vercel uses APPS_SCRIPT_URL and MEDMETRIC_BACKEND_SECRET; Apps Script stores the same backend secret as a Script Property. The backend secret stays on the servers. Never commit .env.local.

Code.gs accepts signed, time-limited POST requests, reads only the three fixed source tabs, and never writes to the spreadsheet. Its public GET response contains only a service status. The web app deployment runs as its owner; public endpoint reachability does not bypass request authentication.

Use Node.js 22 or newer. npm ci, npm test, npm run build. No Google OAuth client ID or client secret is used.
