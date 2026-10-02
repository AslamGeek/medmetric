import fs from 'node:fs';
import assert from 'node:assert/strict';
const required=['app/page.jsx','app/layout.jsx','app/globals.css','app/api/config/route.js','app/api/dashboard/route.js','app/api/drilldown/route.js','app/api/snapshot/route.js','components/Dashboard.jsx','components/ChartPanel.jsx','components/ProductView.jsx','components/ProductCatalog.jsx','components/ProductRankings.jsx','components/ReportFilters.jsx','lib/report-filters.js','lib/product-rankings.js','lib/product-explorer.js','lib/dashboard-session.js','lib/api.js','lib/analytics.js','lib/sheets.js','next.config.mjs','package.json','package-lock.json','vercel.json'];
required.forEach(file=>assert.ok(fs.existsSync(file),'Missing Next.js deployment file: '+file));
const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));assert.equal(config.framework,'nextjs');assert.equal(config.outputDirectory,'.next');
const source=required.filter(f=>/\.(js|jsx|mjs)$/.test(f)).map(f=>fs.readFileSync(f,'utf8')).join('\n');
assert.ok(!/SpreadsheetApp|HtmlService|google\.script\.run|<\?!=/.test(source),'Apps Script-only code must not remain in the Next.js runtime.');
assert.ok(!source.includes('BEGIN PRIVATE KEY'),'A credential must not be embedded in source.');
console.log('PASS: Next.js root route, API routes, lockfile, framework configuration and source-only runtime.');
