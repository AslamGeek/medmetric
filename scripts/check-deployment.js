import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const required=['app/page.jsx','app/layout.jsx','app/globals.css','app/api/config/route.js','app/api/dashboard/route.js','app/api/drilldown/route.js','app/api/snapshot/route.js','components/Dashboard.jsx','components/ChartPanel.jsx','components/ProductView.jsx','components/ProductCatalog.jsx','components/ProductRankings.jsx','components/ReportFilters.jsx','lib/report-filters.js','lib/product-rankings.js','lib/product-explorer.js','lib/product-liquidity.js','components/LiquidityBadge.jsx','lib/dashboard-session.js','lib/api.js','lib/analytics.js','lib/sheets.js','next.config.mjs','package.json','package-lock.json','vercel.json'];
required.forEach(file=>assert.ok(fs.existsSync(file),'Missing Next.js deployment file: '+file));
const publisher=fs.readFileSync('Commit-and-Push.cmd','utf8');
const manifest=publisher.match(/\$appFiles\s*=\s*@\(([\s\S]*?)\r?\n\)/);
assert.ok(manifest,'Cannot find the publisher source-file list.');
const published=new Set([...manifest[1].matchAll(/'([^']+)'/g)].map(match=>match[1]));
// Walk the real runtime dependencies, including untracked files. A local build can
// pass while the publisher silently leaves those dependencies out of its commit.
const pending=[...required],checked=new Set();
while(pending.length) {
  const file=pending.pop();
  if(checked.has(file))continue;
  checked.add(file);
  assert.ok(published.has(file),'Publisher omits a required deployment file: '+file);
  assert.ok(fs.existsSync(file),'Missing Next.js deployment file: '+file);
  if(!/\.(js|jsx|mjs|css)$/.test(file))continue;
  const contents=fs.readFileSync(file,'utf8');
  for(const match of contents.matchAll(/\b(?:from\s+|import\s*(?:\(\s*)?)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const relative=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]));
    const dependency=[relative,relative+'.js',relative+'.jsx',relative+'.mjs',relative+'/index.js',relative+'/index.jsx'].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
    assert.ok(dependency,'Cannot resolve '+match[1]+' imported by '+file);
    pending.push(dependency);
  }
}
const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));assert.equal(config.framework,'nextjs');assert.equal(config.outputDirectory,'.next');
const source=required.filter(f=>/\.(js|jsx|mjs)$/.test(f)).map(f=>fs.readFileSync(f,'utf8')).join('\n');
assert.ok(!/SpreadsheetApp|HtmlService|google\.script\.run|<\?!=/.test(source),'Apps Script-only code must not remain in the Next.js runtime.');
assert.ok(!source.includes('BEGIN PRIVATE KEY'),'A credential must not be embedded in source.');
console.log('PASS: Next.js deployment files, runtime dependencies, publisher file list, framework configuration and source-only runtime.');
