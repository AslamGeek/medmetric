// Report and visual filters share these rules, but never share mutable state.
export function patchReportFilters(current,patch) {
  const next={...current,...patch};
  if(patch.start&&patch.start>next.end)next.end=patch.start;
  if(patch.end&&patch.end<next.start)next.start=patch.end;
  if('agency' in patch&&!('brand' in patch))next.brand='';
  return next;
}

export function periodPreset(months,preset,end=months.at(-1)) {
  if(!months.length)return {};
  if(preset==='all')return {start:months[0],end:months.at(-1)};
  if(preset==='latest')return {start:months.at(-1),end:months.at(-1)};
  const date=new Date(end+'-01T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth()-2);
  return {start:date.toISOString().slice(0,7)<months[0]?months[0]:date.toISOString().slice(0,7),end};
}

export function resolveVisualFilters(report,override) {
  return {...report,...override,product:''};
}

export function productDrillFilters(scope,key,agency) {
  return {...scope,product:key,trendProduct:key,...(agency?{agency}:{})};
}
