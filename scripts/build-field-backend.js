import fs from 'node:fs';
const backend=new URL('../apps-script/Code.gs',import.meta.url);
const shared=fs.readFileSync(new URL('../lib/field-tracking.js',import.meta.url),'utf8').replace(/^export /gm,'');
const marker='// BEGIN GENERATED FIELD TRACKING';
const base=fs.readFileSync(backend,'utf8').split(marker)[0].trimEnd();
fs.writeFileSync(backend,base+'\n\n'+marker+'\n'+shared+'\n// END GENERATED FIELD TRACKING\n');
console.log('Updated Code.gs with the shared field schema and validation.');
