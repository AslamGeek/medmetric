'use client';
import {useEffect,useRef,useState} from 'react';
import ChartPanel,{compact,exact,monthLabel,percentage,DataTable} from './ChartPanel.jsx';
import {displayCoverage} from '../lib/analytics.js';
import {createDashboardSession} from '../lib/dashboard-session.js';
import {patchReportFilters,productDrillFilters} from '../lib/report-filters.js';
import ReportFilters from './ReportFilters.jsx';
import ProductView from './ProductView.jsx';
import ProductCatalog from './ProductCatalog.jsx';
import FieldWorkspace from './FieldWorkspace.jsx';
import DailyReports from './DailyReports.jsx';

const reports=[['overview','Overview','dashboard'],['daily','Daily reports','check'],['products','Product explorer','search'],['field','Doctors','check']];
const numeric=(label,key,currency=false)=>({label,numeric:true,render:r=>exact(r[key],currency)});
const productLink=(label,action)=><button type="button" onClick={action}>{label}</button>;
function Icon({kind}) {
  const paths={dashboard:'M3 3h6v6H3zM13 3h6v6h-6zM3 13h6v6H3zM13 13h6v6h-6z',bars:'M4 19V9h3v10M10 19V3h3v16M16 19v-7h3v7',box:'M3 7l8-4 8 4-8 4-8-4v10l8 4 8-4V7M11 11v10',search:'M17 17l4 4M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',check:'M4 4h14v16H4zM8 11l3 3 5-6'};
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[kind]||paths.dashboard}/></svg>;
}
async function api(path,body,signal) {
  const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal});
  let result;
  try{result=await response.json();}catch{throw new Error(response.status===504?'The sheet took too long to load. Please retry.':'Could not load the dashboard. Please retry.');}
  if(!response.ok)throw new Error(result.error||'Unable to load data.');
  return result;
}
export default function Dashboard() {
  const [fieldRefresh,setFieldRefresh]=useState(0),[fieldLoading,setFieldLoading]=useState(false);
  const [fieldSnapshot,setFieldSnapshot]=useState({data:null,loading:false,error:''});
  const [data,setData]=useState(null),[filters,setFilters]=useState({}),[refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[snapshot,setSnapshot]=useState(null);
  const [view,setView]=useState('overview'),[filtersOpen,setFiltersOpen]=useState(false);
  const [explorerRanking,setExplorerRanking]=useState('sales');
  const [openProductsRequest,setOpenProductsRequest]=useState(0);
  const [drill,setDrill]=useState(null),[drillData,setDrillData]=useState(null),[drillError,setDrillError]=useState('');
  const dialog=useRef(null),origin=useRef(null);
  const [session]=useState(()=>createDashboardSession(force=>api('snapshot',{force},AbortSignal.timeout(55000))));
  useEffect(()=>{
    let active=true;
    if(refresh===0){try{const restored=session.restore(JSON.parse(localStorage.getItem('medmetric-snapshot-v2-prices')));if(restored)setSnapshot(restored);}catch{}}
    setLoading(true);setError('');
    session.load(refresh>0).then(result=>{
      if(!active)return;setSnapshot(result);
      try{localStorage.setItem('medmetric-snapshot-v2-prices',JSON.stringify(result));}catch{}
    }).catch(e=>{if(active)setError(['TimeoutError','AbortError'].includes(e.name)?'The sheet took too long to load. Please retry.':e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[session,refresh]);
  useEffect(()=>{if(!snapshot)return;try{setData(session.dashboard(filters));}catch(e){setError(e.message);}},[session,snapshot,filters]);
  useEffect(()=>{
    if(!drill){dialog.current?.close();return;}
    dialog.current?.showModal();setDrillData(null);setDrillError('');
    try{setDrillData(session.drilldown(data?.filters||{},drill));}catch(e){setDrillError(e.message);}
  },[session,drill,data]);
  function update(patch){setFilters(current=>patchReportFilters({...data?.filters,...current},patch));}
  function openDrill(request={}){setDrill({...request,offset:0});}
  function selectProduct(key,agency,scope=data.filters){
    if(!data.productDetail)origin.current={view,filters:data.filters,scroll:window.scrollY};
    setView('products');setFilters(productDrillFilters(scope,key,agency));window.scrollTo({top:0,behavior:'instant'});
  }
  function navigate(next,ranking){if(ranking){setExplorerRanking(ranking);setOpenProductsRequest(value=>value+1);}origin.current=null;setView(next);update({product:''});setDrill(null);setFiltersOpen(false);window.scrollTo({top:0,behavior:'instant'});}
  function returnToReport(){
    const previous=origin.current;origin.current=null;
    setView(previous?.view||'products');setFilters(previous?.filters||{...data.filters,product:''});
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:previous?.scroll||0,behavior:'instant'})));
  }
  const f=data?.filters||{},o=data?.options,t=data?.trend,q=data?.diagnostics;
  const focused=view==='products'&&!!data?.productDetail,title=focused?data.productDetail.name:reports.find(r=>r[0]===view)[1];
  const agencySales=(t?.agency||[]).map(series=>{
    const values=t.months.flatMap((month,i)=>month>=f.start&&month<=f.end?[series.values[i]]:[]);
    return {agency:series.name,secondary:!values.length||values.some(value=>value==null)?null:values.reduce((sum,value)=>sum+value,0)};
  });
  const warnings=(focused?data.productDetail.warnings:data?.warnings)||[];
  const financial=drill?.kind==='financial';
  const drillColumns=financial?[{label:'Statement',key:'statementId'},{label:'Agency',key:'agency'},{label:'Month',key:'month'},numeric('Primary ₹','primary',true),numeric('Secondary ₹','secondary',true),numeric('Closing ₹','closing',true),...(drillData?.rows.some(row=>!row.full||displayCoverage(row.coverage))?[{label:'Data note',render:row=>displayCoverage(row.coverage)||(!row.full?'Partial / unconfirmed':'—')}]:[])]:[{label:'Canonical product',key:'productName'},{label:'SKU',key:'sku'},{label:'Raw product name',key:'rawName'},{label:'Agency',key:'agency'},{label:'Month',key:'month'},numeric('Sale units','units'),numeric('QOH','qoh'),numeric('Closing value ₹','value',true),numeric('Age observation','age'),{label:'Status',key:'status'}];
  drillColumns.push({label:'Source PDF',render:r=>/^https:\/\//i.test(r.source)?<a href={r.source} target="_blank" rel="noopener noreferrer">Open PDF</a>:r.source||'—'},{label:'Sheet row',render:r=><a href={'https://docs.google.com/spreadsheets/d/1dYodW1QJQBAXvFQph-zhA_iVIjmt_YFUFlbnuZhpluE/edit#gid='+(financial?'269896520':'2004808600')+'&range=A'+r.sheetRow+':'+(financial?'N':'S')+r.sheetRow} target="_blank" rel="noopener noreferrer">{r.sheetRow}</a>});
  if(!financial)drillColumns.push({label:'Source line',key:'sourceLine'});
  return <div className="bi-app">
    <a className="skip-link" href="#report-content">Skip to report</a>
    <aside className="report-sidebar"><button className="identity" onClick={()=>navigate('overview')} aria-label="MedMetric overview"><span className="mark" aria-hidden="true">m<span>•</span></span><span>MEDMETRIC<span className="identity-sub">SALES INTELLIGENCE</span></span></button><p className="nav-caption">REPORTS</p><nav aria-label="Reports">{reports.map(([key,label,icon])=><button key={key} className={(focused?'products':view)===key?'active':''} aria-current={(focused?'products':view)===key?'page':undefined} onClick={()=>navigate(key)}><Icon kind={icon}/><span>{label}</span></button>)}</nav><div className="sidebar-bottom"><span className="source-status"><i/>Google Sheets source</span><p>{data?q.agencies.length+' agencies · '+o.months.length+' months':'Saved data workspace'}</p><button type="button" onClick={()=>openDrill()} disabled={!data}>Inspect source rows ↗</button></div></aside>
    <div className="report-workspace">
    {data&&view!=='field'&&view!=='daily'&&<section className={'report-filter-bar '+(filtersOpen?'filters-open':'')} aria-label="Persistent report controls"><div className="filter-summary"><button type="button" className="mobile-filter-toggle" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(v=>!v)}>Filters <span>{filtersOpen?'−':'+'}</span></button><div className="selection-chips" aria-label="Active report selection"><span>{f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' → '+monthLabel(f.end)}</span><button type="button" onClick={()=>update({agency:''})} disabled={!f.agency}>{f.agency||'All agencies'}{f.agency?' ×':''}</button>{f.brand&&<button type="button" onClick={()=>update({brand:''})}>{f.brand} ×</button>}{f.includeExcluded&&<button type="button" onClick={()=>update({includeExcluded:false})}>Excluded included ×</button>}</div><details className="report-more"><summary>More filters</summary><div className="more-filter-popover"><label>Explore a product<select value={f.product} onChange={e=>e.target.value?selectProduct(e.target.value):returnToReport()}><option value="">All products</option>{o.products.map(p=><option key={p.key} value={p.key}>{p.name}{p.sku?' · '+p.sku:''}</option>)}</select></label><label className="inclusion-check"><input type="checkbox" checked={f.includeExcluded} onChange={e=>update({includeExcluded:e.target.checked})}/>Include excluded &amp; unmapped</label></div></details></div><ReportFilters data={data} onChange={update} onReset={()=>setFilters({})} disabled={loading}/></section>}
    <main className="report-content" id="report-content">
      {view!=='field'&&view!=='daily'&&<div className="report-title"><div>{focused&&<button type="button" className="text-button report-back" onClick={returnToReport}>← Back to {reports.find(r=>r[0]===origin.current?.view)?.[1]||'products'}</button>}{!focused&&<p className="eyebrow">SALES INTELLIGENCE</p>}<h1>{title}</h1>{!focused&&<p className="subtitle">{view==='overview'?'Your business in one view. Select a report to explore further.':view==='products'?'Find best sellers, prioritise stock and open a product.':'Check coverage and trace the source behind your numbers.'}</p>}</div>{!focused&&<span className="report-live-label">{(view==='field'?fieldLoading:loading)?'Refreshing snapshot…':'Saved snapshot · filters update instantly'}</span>}</div>}
      {error&&view!=='field'&&view!=='daily'&&<div className="message error" role="alert">{data?'Could not refresh. Your saved data is still available. ':''}{error}</div>}
      {!data&&view!=='field'&&view!=='daily'&&<section className="panel"><p role="status">{loading?'Loading saved dashboard data…':'No data loaded yet.'}</p>{!loading&&<button className="button" onClick={()=>setRefresh(v=>v+1)}>Retry</button>}</section>}
      <FieldWorkspace visible={view==='field'} loadRequested={view==='products'} refreshVersion={fieldRefresh} onLoadingChange={setFieldLoading} onSnapshotChange={setFieldSnapshot}/>
      <DailyReports visible={view==='daily'}/>
      {data&&<div id="dashboard" aria-busy={loading}>
        {view!=='field'&&view!=='daily'&&!!warnings.length&&<details className="report-warnings"><summary>{warnings.length} data coverage {warnings.length===1?'note':'notes'} · view details</summary>{warnings.map(w=><p key={w}>{w}</p>)}</details>}
        {focused&&<ProductView key={data.productDetail.key} data={data} onSource={openDrill} onAgency={agency=>update({agency})}/>}
        {!focused&&view==='overview'&&<>
          <section className="kpi-grid" aria-label="Financial performance">{[['Primary sales','primary','Agency purchases'],['Secondary sales','secondary','Agency sales'],['Closing stock','closing',monthLabel(f.end)+' snapshot']].map(([label,key,note])=><article className="kpi" key={key}><p>{label}<span>₹</span></p><strong title={exact(data.kpis[key],true)}>{compact(data.kpis[key],true)}</strong><small>{note}</small><span className={'kpi-line '+(key==='secondary'?'secondary-line':'primary-line')}/></article>)}<article className="kpi"><p>Secondary growth<span>%</span></p><strong className={data.kpis.comparison.value<0?'negative':'positive'}>{percentage(data.kpis.comparison.value)}</strong><small>{data.kpis.comparison.value==null?data.kpis.comparison.reason:'vs '+monthLabel(data.kpis.comparison.previousMonth)}</small></article></section>
          <p className="scope-note">Financial values use month and agency. Brand and inclusion filters apply to product reports.</p><div className="overview-analysis"><div className="overview-charts">
            <ChartPanel title="Primary vs secondary" subtitle={(f.start===f.end?'Up to 12 months through selection':'Selected monthly range')+' · ₹'} currency coverage={t.financial.map(r=>r.partial?'Partial / incomplete':'Full month')} labels={t.months.map(monthLabel)} datasets={[{label:'Primary sales',data:t.financial.map(r=>r.primary)},{label:'Secondary sales',data:t.financial.map(r=>r.secondary)}]} onPoint={i=>openDrill({kind:'financial',month:t.months[i]})} columns={[{label:'Month',render:r=>productLink(monthLabel(r.month),()=>openDrill({kind:'financial',month:r.month}))},numeric('Primary ₹','primary',true),numeric('Secondary ₹','secondary',true),...(t.financial.some(row=>row.partial)?[{label:'Data note',render:row=>row.partial?'Partial / incomplete':'—'}]:[])]} rows={t.financial}/>
            <ChartPanel title="Agency sales contribution" subtitle={'Secondary sales · '+(f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end))+' · ₹'} currency type="bar" horizontal labels={agencySales.map(row=>row.agency)} datasets={[{label:'Secondary sales',data:agencySales.map(row=>row.secondary)}]} onPoint={i=>openDrill({kind:'financial',agency:agencySales[i].agency})} columns={[{label:'Agency',render:row=>productLink(row.agency,()=>openDrill({kind:'financial',agency:row.agency}))},numeric('Secondary ₹','secondary',true)]} rows={agencySales}/>
          </div></div>
          <div className="report-shortcuts"><button type="button" onClick={()=>navigate('products','sales')}><Icon kind="bars"/><span><strong>Find best sellers</strong><small>Rank product units sold for the selected period</small></span><b>→</b></button><button type="button" onClick={()=>navigate('products','movement')}><Icon kind="box"/><span><strong>Find stock needing attention</strong><small>Find zero or low sales with stock still held by an agency</small></span><b>→</b></button></div>
        </>}
        <div hidden={focused||view!=='products'}><ProductCatalog data={data} fieldSnapshot={fieldSnapshot} onRefreshDoctors={()=>setFieldRefresh(v=>v+1)} onSelect={selectProduct} rankingView={explorerRanking} onRankingViewChange={setExplorerRanking} openProductsRequest={openProductsRequest}/></div>
      </div>}
      <footer><span>MedMetric · Sales &amp; field reports</span>{view!=='daily'&&<button type="button" className="text-button" disabled={view==='field'?fieldLoading:loading||(view==='products'&&fieldSnapshot.loading)} onClick={()=>{if(view==='field'||view==='products')setFieldRefresh(v=>v+1);if(view!=='field')setRefresh(v=>v+1);}}>↻ Refresh data</button>}</footer>
    </main></div>
    <dialog ref={dialog} onCancel={()=>setDrill(null)} aria-labelledby="drill-title"><div className="dialog-header"><div><p className="eyebrow">TRACE THE NUMBERS</p><h2 id="drill-title">{financial?'Financial statements':focused?data.productDetail.name+' · source rows':'Product source rows'}</h2></div><button className="button" onClick={()=>setDrill(null)}>Close ✕</button></div><p role="status">{drillError||(!drillData?'Reading source rows…':'Original source names preserved. Sale is units; Value is closing inventory value.')}</p><div id="drill-table"><DataTable columns={drillColumns} rows={drillData?.rows||[]}/></div><div className="pagination"><button className="button" disabled={!drillData||!drillData.offset} onClick={()=>setDrill(r=>({...r,offset:Math.max(0,r.offset-50)}))}>← Previous</button><span>{drillData?.total?(drillData.offset+1)+'–'+Math.min(drillData.offset+50,drillData.total)+' of '+drillData.total:'0 rows'}</span><button className="button" disabled={!drillData||drillData.offset+50>=drillData.total} onClick={()=>setDrill(r=>({...r,offset:r.offset+50}))}>Next →</button></div></dialog>
  </div>;
}
