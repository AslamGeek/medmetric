'use client';
import { useEffect, useRef, useState } from 'react';
import ChartPanel, { compact, exact, monthLabel, DataTable } from './ChartPanel.jsx';
import { createDashboardSession } from '../lib/dashboard-session.js';
import ProductView from './ProductView.jsx';
import ProductCatalog from './ProductCatalog.jsx';

const productLink = (label, action) => <button type="button" onClick={action}>{label}</button>;
const numeric = (label,key,currency=false) => ({ label,numeric:true,render:r => exact(r[key],currency) });
async function api(path, body, signal) {
  const response = await fetch('/api/' + path, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body), cache:'no-store',signal });
  let result;
  try { result = await response.json(); } catch { throw new Error(response.status===504 ? 'The sheet took too long to load. Please retry.' : 'Could not load the dashboard. Please retry.'); }
  if (!response.ok) { const error = new Error(result.error || 'Unable to load data.'); error.status = response.status; throw error; }
  return result;
}

export default function Dashboard() {
  const [data,setData] = useState(null), [filters,setFilters] = useState({}), [refresh,setRefresh] = useState(0);
  const [loading,setLoading] = useState(true), [error,setError] = useState('');
  const [maxUnits,setMaxUnits] = useState('0'), [minAge,setMinAge] = useState('');
  const [drill,setDrill] = useState(null), [drillData,setDrillData] = useState(null), [drillError,setDrillError] = useState('');
  const dialog = useRef(null);
  const [snapshot,setSnapshot] = useState(null);
  const [view,setView] = useState('overview');
  const [session] = useState(()=>createDashboardSession(force=>api('snapshot',{force},AbortSignal.timeout(55000))));

  useEffect(() => {
    let active=true;
    if(refresh===0){
      try {
        const cached=JSON.parse(localStorage.getItem('medmetric-snapshot-v1'));
        const restored=session.restore(cached);if(restored)setSnapshot(restored);
      } catch { /* A blocked or missing browser cache does not prevent loading. */ }
    }
    setLoading(true); setError('');
    session.load(refresh>0).then(result => {
      if(!active)return;
      setSnapshot(result);
      try {localStorage.setItem('medmetric-snapshot-v1',JSON.stringify(result));}catch { /* Storage is optional. */ }
    }).catch(e => {
      if(!active)return;
      setError(['TimeoutError','AbortError'].includes(e.name)?'The sheet took too long to load. Please retry.':e.message);
    }).finally(() => { if(active)setLoading(false); });
    return () => {active=false;};
  }, [session,refresh]);
  useEffect(()=>{
    if(!snapshot)return;
    try {
      const result=session.dashboard(filters);
      setData(result);setMaxUnits(String(result.filters.maxUnits));setMinAge(result.filters.minAge==null?'':String(result.filters.minAge));
    } catch(e){setError(e.message);}
  },[session,snapshot,filters]);
  useEffect(() => {
    if(!drill) { dialog.current?.close(); return; }
    dialog.current?.showModal(); setDrillData(null); setDrillError('');
    try {setDrillData(session.drilldown(data?.filters || {},drill));}catch(e){setDrillError(e.message);}
  }, [session,drill,data]);

  function update(patch) {
    const f={...data?.filters,...patch};
    if(patch.start && patch.start > f.end)f.end=patch.start;
    if(patch.end && patch.end < f.start)f.start=patch.end;
    if('agency' in patch)f.brand='';
    setFilters(f);
  }
  function reset(){setFilters({});setMaxUnits('0');setMinAge('');}
  function openDrill(request={}){
    if(request.productKey){setView('products');update({product:request.productKey,trendProduct:request.productKey});}
    setDrill({...request,offset:0});
  }
  function selectProduct(key){setView('products');update({product:key,trendProduct:key});window.scrollTo({top:0,behavior:'instant'});}
  function navigate(next){setView(next);update({product:''});setDrill(null);window.scrollTo({top:0,behavior:'instant'});}

  const f=data?.filters || {}, o=data?.options, t=data?.trend, q=data?.diagnostics;
  const focused=!!data?.productDetail;
  const warnings=(focused?data.productDetail.warnings:data?.warnings)||[];
  const sourceColumn={label:'Source PDF',render:r=>/^https:\/\//i.test(r.source)?<a href={r.source} target="_blank" rel="noopener noreferrer">Open PDF</a>:r.source||'—'};
  const financial=drill?.kind==='financial';
  const drillColumns=financial?[{label:'Statement',key:'statementId'},{label:'Agency',key:'agency'},{label:'Month',key:'month'},numeric('Primary ₹','primary',true),numeric('Secondary ₹','secondary',true),numeric('Closing ₹','closing',true),{label:'Coverage',key:'coverage'}]:[{label:'Canonical product',key:'productName'},{label:'SKU',key:'sku'},{label:'Raw product name',key:'rawName'},{label:'Agency',key:'agency'},{label:'Month',key:'month'},numeric('Sale units','units'),numeric('QOH','qoh'),numeric('Closing value ₹','value',true),numeric('Age observation','age'),{label:'Status',key:'status'}];
  drillColumns.push(sourceColumn,{label:'Sheet row',render:r=><a href={'https://docs.google.com/spreadsheets/d/1dYodW1QJQBAXvFQph-zhA_iVIjmt_YFUFlbnuZhpluE/edit#gid='+(financial?'269896520':'2004808600')+'&range=A'+r.sheetRow+':'+(financial?'N':'S')+r.sheetRow} target="_blank" rel="noopener noreferrer">{r.sheetRow}</a>});
  if(!financial)drillColumns.push({label:'Source line',key:'sourceLine'});

  return <>
    <header className="topbar"><a className="identity" href="#overview" aria-label="MedMetric overview" onClick={()=>navigate('overview')}><span className="mark" aria-hidden="true">m<span>•</span></span><span>MEDMETRIC<span className="identity-sub">SALES INTELLIGENCE</span></span></a><nav aria-label="Dashboard sections">{[['overview','Overview'],['products','Products'],['inventory','Inventory']].map(([key,label])=><button key={key} className={(focused?'products':view)===key?'active':''} aria-current={(focused?'products':view)===key?'page':undefined} onClick={()=>navigate(key)}>{label}</button>)}</nav><div className="account-actions"><span className="readonly"><span />Read-only workspace</span></div></header>
    <main id="overview">
      {focused && <button className="text-button back-products" onClick={()=>navigate('products')}>← All products</button>}<div className="page-heading"><div><p className="eyebrow">{focused?'PRODUCT EXPLORER':view==='products'?'EXPLORE YOUR PRODUCTS':view==='inventory'?'INVENTORY':'BUSINESS OVERVIEW'}</p><h1>{focused?data.productDetail.name:view==='products'?'Products':view==='inventory'?'Inventory':'MedMetric Sales Intelligence'}</h1><p className="subtitle">{focused?'Sales trends, agency performance and stock':view==='products'?'Choose a product to understand its performance':view==='inventory'?'Closing stock and movement by product':'Agency Stock & Sales Analytics'}</p></div>{<div className="heading-actions"><span className="muted">{data?'Loaded '+new Date(data.loadedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'Reading your sheet'}</span><button className="button" disabled={loading} onClick={()=>setRefresh(v=>v+1)}>↻ &nbsp; Refresh data</button></div>}</div>
      {error && <div className="message error" role="alert">{data?'Could not refresh. Your last loaded data is still available. ':''}{error}</div>}
      {!data && <section className="panel"><p role="status">{loading?'Loading dashboard…':'No data loaded yet.'}</p>{!loading && <button className="button" onClick={()=>setRefresh(v=>v+1)}>Retry</button>}</section>}
      {data && <>
        <fieldset className="filters" disabled={loading} aria-label="Dashboard filters">
          <label>From month<select value={f.start} onChange={e=>update({start:e.target.value})}>{o.months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
          <label>To month<select value={f.end} onChange={e=>update({end:e.target.value})}>{o.months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
          <label>Agency<select value={f.agency} onChange={e=>update({agency:e.target.value})}><option value="">All agencies</option>{o.agencies.map(a=><option key={a}>{a}</option>)}</select></label>
          <label>Brand group<select value={f.brand} onChange={e=>update({brand:e.target.value})}><option value="">All brands</option>{o.brands.map(b=><option key={b}>{b}</option>)}</select></label>
          <label className="product-filter">Product<select value={f.product} onChange={e=>e.target.value?selectProduct(e.target.value):navigate('products')}><option value="">All products</option>{o.products.map(p=><option value={p.key} key={p.key}>{p.name}{p.sku?' · '+p.sku:''}</option>)}</select></label>
          <label className="check"><input type="checkbox" checked={f.includeExcluded} onChange={e=>update({includeExcluded:e.target.checked})}/><span>Include excluded<br/>&amp; unmapped</span></label><button className="text-button" onClick={reset}>Reset</button>
        </fieldset>
        <p className="scope-note">{focused?'Showing only this product. Change the period or agency to compare its performance.':view==='overview'?'Financial totals use month and agency filters. Product charts use your brand and inclusion filters.':'Select a product to open its trends, agency comparisons and insights.'}</p>
        {loading && <div className="message" role="status">Updating your view…</div>}
        {!!warnings.length && <div className="warnings">{warnings.map(w=><p key={w}>{w}</p>)}</div>}
        <div id="dashboard" aria-busy={loading}>
          {focused && <ProductView data={data} onSource={openDrill} onAgency={agency=>update({agency})}/>}
          {!focused && view==='overview' && <><div className="section-heading"><h2>Business performance</h2><span className="period-label">{f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end)} · {f.agency||'All agencies'}</span></div>
          <section className="kpi-grid" aria-label="Financial performance">{[['Primary sales','primary','Purchases by your agencies','primary-line'],['Secondary sales','secondary','Sales from your agencies','secondary-line'],['Closing stock','closing',monthLabel(f.end)+' closing balance','neutral-line']].map(([label,key,note,line])=><article className="kpi" key={key}><p>{label}<span>₹</span></p><strong title={exact(data.kpis[key],true)} aria-label={exact(data.kpis[key],true)}>{compact(data.kpis[key],true)}</strong><small>{note}</small><span className={'kpi-line '+line}/></article>)}<article className="kpi"><p>Secondary growth<span>↗</span></p><strong className={data.kpis.comparison.value==null?'':data.kpis.comparison.value<0?'negative':'positive'}>{data.kpis.comparison.value==null?'—':(data.kpis.comparison.value>0?'+':'')+data.kpis.comparison.value.toFixed(1)+'%'}</strong><small>{data.kpis.comparison.value==null?data.kpis.comparison.reason:'vs '+monthLabel(data.kpis.comparison.previousMonth)+' · comparable agencies'}</small><span className="kpi-line neutral-line"/></article></section>
          <div className="chart-grid financial-grid">
            <ChartPanel title="Primary vs secondary" subtitle={(f.start===f.end?'Up to 12 months through selection':'Selected monthly range')+' · ₹'} currency labels={t.months.map(monthLabel)} datasets={[{label:'Primary sales',data:t.financial.map(r=>r.primary)},{label:'Secondary sales',data:t.financial.map(r=>r.secondary)}]} onPoint={i=>openDrill({kind:'financial',month:t.months[i]})} columns={[{label:'Month',render:r=>productLink(monthLabel(r.month),()=>openDrill({kind:'financial',month:r.month}))},numeric('Primary ₹','primary',true),numeric('Secondary ₹','secondary',true),{label:'Coverage',render:r=>r.partial?'Partial / incomplete':'Full'}]} rows={t.financial}/>
            <ChartPanel title="Secondary by agency" subtitle="Agency contribution over time · ₹" currency type="bar" labels={t.months.map(monthLabel)} datasets={t.agency.map(s=>({label:s.name,data:s.values}))} onPoint={i=>openDrill({kind:'financial',month:t.months[i]})} columns={[{label:'Month',render:r=>monthLabel(r.month)},...t.agency.map((s,i)=>({label:s.name+' ₹',numeric:true,render:r=>exact(r.values[i],true)}))]} rows={t.months.map((month,i)=>({month,values:t.agency.map(s=>s.values[i])}))}/>
          </div>
          <section className="insights panel"><div className="insights-title"><span className="insight-icon" aria-hidden="true">✧</span><div><h2>What the numbers say</h2><p>Calculated from your selected data</p></div></div><ul>{(data.insights.length?data.insights:['No data available for the selected filters.']).map(s=><li key={s}>{s}</li>)}</ul></section>
          </>}
          {!focused && view==='products' && <ProductCatalog products={o.products} onSelect={selectProduct}/>}
          {!focused && view!=='inventory' && <><div id="products" className="section-heading anchor"><div><p className="eyebrow">PRODUCT INTELLIGENCE</p><h2>Movement, mapped to your products</h2></div><span className="muted">{o.products.length} available products · {f.includeExcluded?'all inclusion flags':'Include_In_Charts = YES'}</span></div>
          <div className="chart-grid">
            <ChartPanel title="Top products by units sold" subtitle="Top 10 · selected period · normalized products" type="bar" horizontal labels={data.topProducts.map(r=>r.name)} datasets={[{label:'Units sold',data:data.topProducts.map(r=>r.units)}]} onPoint={i=>selectProduct(data.topProducts[i].key)} columns={[{label:'Product',render:r=>productLink(r.name,()=>selectProduct(r.key))},{label:'SKU',key:'sku'},numeric('Units sold','units')]} rows={data.topProducts}/>
            <ChartPanel title="Product sales trend" subtitle="Monthly units sold, split by agency" labels={t.months.map(monthLabel)} datasets={t.product.map(s=>({label:s.name,data:s.values}))} onPoint={i=>openDrill({productKey:t.productKey,month:t.months[i]})} columns={[{label:'Month',render:r=>productLink(monthLabel(r.month),()=>openDrill({productKey:t.productKey,month:r.month}))},...t.product.map((s,i)=>({label:s.name+' units',numeric:true,render:r=>exact(r.values[i])}))]} rows={t.months.map((month,i)=>({month,values:t.product.map(s=>s.values[i])}))}><label className="trend-picker">Product to explore<select disabled={!!f.product || loading} value={f.product || f.trendProduct} onChange={e=>selectProduct(e.target.value)}>{o.products.map(p=><option value={p.key} key={p.key}>{p.name}</option>)}</select></label></ChartPanel>
          </div>
          </>}
          {!focused && view!=='products' && <><div id="inventory" className="section-heading anchor"><div><p className="eyebrow">INVENTORY INTELLIGENCE</p><h2>Know where your stock stands</h2></div><span className="muted">Snapshot · {monthLabel(f.end)}</span></div>
          <div className="chart-grid inventory-grid">
            <ChartPanel title="Closing stock by product" subtitle="Top 10 by closing inventory value · ₹" type="bar" horizontal currency labels={data.inventory.map(r=>r.name)} datasets={[{label:'Closing stock',data:data.inventory.map(r=>r.value)}]} onPoint={i=>selectProduct(data.inventory[i].key)} columns={[{label:'Product',render:r=>productLink(r.name,()=>selectProduct(r.key))},numeric('QOH','qoh'),numeric('Closing stock ₹','value',true)]} rows={data.inventory}/>
            <article className="panel"><div className="panel-header"><div><h2>Slow / no movement candidates</h2><p>Positive closing quantity · individual stock observations</p></div><span className="count">{data.candidateCount}</span></div><form className="thresholds" onSubmit={e=>{e.preventDefault();update({maxUnits:maxUnits===''?0:Number(maxUnits),minAge:minAge===''?null:Number(minAge)});}}><label>Units sold ≤<input type="number" min="0" step="any" value={maxUnits} onChange={e=>setMaxUnits(e.target.value)}/></label><label>Stock age ≥<input type="number" min="0" step="any" placeholder="Any" value={minAge} onChange={e=>setMinAge(e.target.value)}/></label><button type="submit" className="button" disabled={loading}>Apply</button></form><p className="scope-note">Age is shown as recorded in the sheet; its unit is not assumed.</p><div className="candidates"><DataTable columns={[{label:'Product / Agency',render:r=><>{productLink(r.productName,()=>selectProduct(r.productKey))}<div className="muted">{r.agency}</div></>},numeric('QOH','qoh'),numeric('Units','units'),numeric('Age','age'),numeric('Closing ₹','value',true)]} rows={data.candidates} empty="No candidates match these thresholds."/></div><button className="text-button footer-link" onClick={()=>openDrill({kind:'candidates'})}>{data.candidateCount>25?'Showing 25 of '+data.candidateCount+' · ':''}Explore candidate source rows →</button></article>
          </div>
          </>}
          {!focused && view==='overview' && <>
          <details className="diagnostics panel"><summary><span>Data quality &amp; traceability</span><span className="muted">Source coverage, mappings and exclusions</span></summary><div className="diagnostic-grid">{[['Latest statement month',monthLabel(q.latestMonth)],['Agencies loaded',q.agencies.join(', ')||'—'],['Raw names · all data',q.rawNames],['Normalized SKUs · all data',q.skus],['Unmapped names · selected scope',q.unmappedRawCount],['Rows excluded: NO · scope',q.excludedNo],['Other non-YES rows · scope',q.excludedOther],['Raw observations · all data',q.rawRows]].map(([label,value])=><div key={label}><p>{label}</p><strong>{value}</strong></div>)}</div><p className="scope-note">Selected scope = month range + agency, before brand/product/inclusion filters. Each refresh reads the latest spreadsheet data. Missing observations remain unavailable, not invented zeros.</p><div className="diagnostic-actions"><button className="button" onClick={()=>openDrill()}>Inspect product source rows</button><button className="button" onClick={()=>openDrill({kind:'financial'})}>Inspect financial statements</button></div><h3>Unmapped aliases in selected scope</h3><DataTable columns={[{label:'Raw name',key:'rawName'},{label:'Agency',key:'agency'},{label:'Mapping issue',key:'issue'}]} rows={q.unmapped} empty="All raw names in this scope have an exact, unambiguous mapping."/></details></>}
        </div>
      </>}
      <footer><span>MedMetric <span className="footer-dot">/</span> Clarity in every number.</span><span>Google Sheets source · Read-only · No AI-generated insights</span></footer>
    </main>
    <dialog ref={dialog} onCancel={()=>setDrill(null)} aria-labelledby="drill-title"><div className="dialog-header"><div><p className="eyebrow">TRACE THE NUMBERS</p><h2 id="drill-title">{financial?'Financial statements':focused?data.productDetail.name+' · source rows':'Product source rows'}</h2></div><button className="button" onClick={()=>setDrill(null)}>Close ✕</button></div><p role="status">{drillError || (!drillData?'Reading source rows…':'Original source names preserved. Sale is units; Value is closing inventory value.')}</p><div id="drill-table"><DataTable columns={drillColumns} rows={drillData?.rows || []}/></div><div className="pagination"><button className="button" disabled={!drillData || !drillData.offset} onClick={()=>setDrill(r=>({...r,offset:Math.max(0,r.offset-50)}))}>← Previous</button><span>{drillData?.total?`${drillData.offset+1}–${Math.min(drillData.offset+50,drillData.total)} of ${drillData.total}`:'0 rows'}</span><button className="button" disabled={!drillData || drillData.offset+50>=drillData.total} onClick={()=>setDrill(r=>({...r,offset:r.offset+50}))}>Next →</button></div></dialog>
  </>;
}
