'use client';
import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import ChartPanel, { compact, exact, monthLabel, DataTable } from './ChartPanel.jsx';

const scope = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const productLink = (label, action) => <button type="button" onClick={action}>{label}</button>;
const numeric = (label,key,currency=false) => ({ label,numeric:true,render:r => exact(r[key],currency) });
async function api(path, token, body, signal) {
  const response = await fetch('/api/' + path, { method:'POST', headers:{ 'Content-Type':'application/json',Authorization:'Bearer ' + token }, body:JSON.stringify(body), cache:'no-store',signal });
  let result;
  try { result = await response.json(); } catch { throw new Error('The server did not return a valid response. Refresh and try again.'); }
  if (!response.ok) { const error = new Error(result.error || 'Unable to load data.'); error.status = response.status; throw error; }
  return result;
}

export default function Dashboard() {
  const [config,setConfig] = useState(null), [googleReady,setGoogleReady] = useState(false);
  const [token,setToken] = useState(''), [authBusy,setAuthBusy] = useState(false);
  const [data,setData] = useState(null), [filters,setFilters] = useState({}), [refresh,setRefresh] = useState(0);
  const [loading,setLoading] = useState(false), [error,setError] = useState('');
  const [maxUnits,setMaxUnits] = useState('0'), [minAge,setMinAge] = useState('');
  const [drill,setDrill] = useState(null), [drillData,setDrillData] = useState(null), [drillError,setDrillError] = useState('');
  const expiration = useRef(null), authGeneration = useRef(0), dialog = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/config', { cache:'no-store',signal:controller.signal }).then(r => { if(!r.ok)throw new Error('Cannot load app configuration. Please refresh.'); return r.json(); }).then(setConfig).catch(e => { if(e.name !== 'AbortError')setError(e.message); });
    return () => { controller.abort(); clearTimeout(expiration.current); authGeneration.current++; };
  }, []);
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    api('dashboard',token,{ filters },controller.signal).then(result => {
      if(controller.signal.aborted)return;
      setData(result); setMaxUnits(String(result.filters.maxUnits)); setMinAge(result.filters.minAge == null ? '' : String(result.filters.minAge));
    }).catch(e => {
      if(controller.signal.aborted)return;
      if(e.status === 401 || e.status === 403) disconnect();
      setError(e.message);
    }).finally(() => { if(!controller.signal.aborted)setLoading(false); });
    return () => controller.abort();
  }, [token,filters,refresh]);
  useEffect(() => {
    if(!drill || !token) { dialog.current?.close(); return; }
    dialog.current?.showModal(); setDrillData(null); setDrillError('');
    const controller = new AbortController();
    api('drilldown',token,{ filters:data?.filters || {},request:drill },controller.signal).then(result => { if(!controller.signal.aborted)setDrillData(result); }).catch(e => {
      if(controller.signal.aborted)return;
      if(e.status === 401 || e.status === 403) { disconnect(); setError(e.message); }
      else setDrillError(e.message);
    });
    return () => controller.abort();
  }, [drill,token,data]);

  function disconnect() {
    authGeneration.current++; clearTimeout(expiration.current); setToken('');setData(null);setDrill(null);setDrillData(null);setAuthBusy(false);setLoading(false);
  }
  function connect() {
    if(!config?.configured || !window.google?.accounts?.oauth2)return;
    setAuthBusy(true);setError('');const generation=++authGeneration.current;
    try {
      const client=window.google.accounts.oauth2.initTokenClient({ client_id:config.clientId, scope, include_granted_scopes:false,
        callback:response => {
          if(generation!==authGeneration.current)return;
          setAuthBusy(false);
          if(response.error || !response.access_token) { setError('Google authorization was not completed. Try connecting again.');return; }
          if(!window.google.accounts.oauth2.hasGrantedAllScopes(response,scope)) { setError('Read-only Google Sheets permission is required to load this dashboard.');return; }
          clearTimeout(expiration.current);setData(null);setFilters({});setToken(response.access_token);
          expiration.current=setTimeout(() => { disconnect();setError('Your Google connection expired. Connect again to continue.'); },Math.max(1,(Number(response.expires_in)||3600)-30)*1000);
        }, error_callback:() => { if(generation===authGeneration.current){setAuthBusy(false);setError('The Google popup was closed or blocked. Allow popups and try again.');} }
      });
      client.requestAccessToken({ prompt:'select_account' });
    } catch { setAuthBusy(false);setError('Google sign-in could not open. Refresh and try again.'); }
  }
  function update(patch) {
    const f={...data?.filters,...patch};
    if(patch.start && patch.start > f.end)f.end=patch.start;
    if(patch.end && patch.end < f.start)f.start=patch.end;
    if(['start','end','agency','brand','includeExcluded'].some(k=>k in patch)){f.product='';f.trendProduct='';}
    if('agency' in patch)f.brand='';
    setFilters(f);
  }
  function reset(){setFilters({});setMaxUnits('0');setMinAge('');}
  function openDrill(request={}){setDrill({...request,offset:0});}

  const f=data?.filters || {}, o=data?.options, t=data?.trend, q=data?.diagnostics;
  const sourceColumn={label:'Source PDF',render:r=>/^https:\/\//i.test(r.source)?<a href={r.source} target="_blank" rel="noopener noreferrer">Open PDF</a>:r.source||'—'};
  const financial=drill?.kind==='financial';
  const drillColumns=financial?[{label:'Statement',key:'statementId'},{label:'Agency',key:'agency'},{label:'Month',key:'month'},numeric('Primary ₹','primary',true),numeric('Secondary ₹','secondary',true),numeric('Closing ₹','closing',true),{label:'Coverage',key:'coverage'}]:[{label:'Canonical product',key:'productName'},{label:'SKU',key:'sku'},{label:'Raw product name',key:'rawName'},{label:'Agency',key:'agency'},{label:'Month',key:'month'},numeric('Sale units','units'),numeric('QOH','qoh'),numeric('Closing value ₹','value',true),numeric('Age observation','age'),{label:'Status',key:'status'}];
  drillColumns.push(sourceColumn,{label:'Sheet row',render:r=><a href={'https://docs.google.com/spreadsheets/d/1dYodW1QJQBAXvFQph-zhA_iVIjmt_YFUFlbnuZhpluE/edit#gid='+(financial?'269896520':'2004808600')+'&range=A'+r.sheetRow+':'+(financial?'N':'S')+r.sheetRow} target="_blank" rel="noopener noreferrer">{r.sheetRow}</a>});
  if(!financial)drillColumns.push({label:'Source line',key:'sourceLine'});

  return <>
    <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={()=>setGoogleReady(true)} onError={()=>setError('Google sign-in could not load. Check your network and refresh.')} />
    <header className="topbar"><a className="identity" href="#overview" aria-label="MedMetric overview"><span className="mark" aria-hidden="true">m<span>•</span></span><span>MEDMETRIC<span className="identity-sub">RENOVA SALES INTELLIGENCE</span></span></a><nav aria-label="Dashboard sections"><a className="active" href="#overview">Overview</a><a href="#products">Products</a><a href="#inventory">Inventory</a></nav><div className="account-actions"><span className="readonly"><span />Read-only workspace</span>{token && <button className="text-button" onClick={disconnect}>Disconnect</button>}</div></header>
    <main id="overview">
      <div className="page-heading"><div><p className="eyebrow">A CLEARER VIEW OF YOUR BUSINESS</p><h1>Renova Sales Intelligence</h1><p className="subtitle">Agency Stock &amp; Sales Analytics</p></div>{token && <div className="heading-actions"><span className="muted">{data?'Loaded '+new Date(data.loadedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'Reading your sheet'}</span><button className="button" disabled={loading} onClick={()=>setRefresh(v=>v+1)}>↻ &nbsp; Refresh data</button></div>}</div>
      {error && <div className="message error" role="alert">{error}</div>}
      {!token && <section className="panel connection-panel"><span className="tag">PRIVATE WORKSPACE</span><h2>Your data. Your Google access.</h2><p>Connect the Google account you use for Renova Sales Data. Your spreadsheet stays private and read-only.</p><button className="button connect-button" onClick={connect} disabled={!config?.configured || !googleReady || authBusy}>{authBusy?'Waiting for Google…':'Connect with Google'}</button><p className="scope-note">Only accounts that already have access to the source sheet can view its data. Disconnecting clears this page&apos;s data.</p>{config && !config.configured && <div className="setup-note"><strong>Google connection needs one-time setup</strong><p>The app is running. Add your Google OAuth web client ID as <code>GOOGLE_CLIENT_ID</code> in this Vercel project, authorize this site&apos;s origin in Google Cloud, then redeploy. No client secret is required.</p></div>}{!config && !error && <p role="status">Loading connection settings…</p>}</section>}
      {token && !data && <section className="panel"><p role="status">{loading?'Reading agency statements and product mappings…':'No data loaded yet.'}</p>{!loading && <button className="button" onClick={()=>setRefresh(v=>v+1)}>Retry</button>}</section>}
      {token && data && <>
        <fieldset className="filters" disabled={loading} aria-label="Dashboard filters">
          <label>From month<select value={f.start} onChange={e=>update({start:e.target.value})}>{o.months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
          <label>To month<select value={f.end} onChange={e=>update({end:e.target.value})}>{o.months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
          <label>Agency<select value={f.agency} onChange={e=>update({agency:e.target.value})}><option value="">All agencies</option>{o.agencies.map(a=><option key={a}>{a}</option>)}</select></label>
          <label>Brand group<select value={f.brand} onChange={e=>update({brand:e.target.value})}><option value="">All brands</option>{o.brands.map(b=><option key={b}>{b}</option>)}</select></label>
          <label className="product-filter">Product<select value={f.product} onChange={e=>update({product:e.target.value})}><option value="">All products</option>{o.products.map(p=><option value={p.key} key={p.key}>{p.name}{p.sku?' · '+p.sku:''}</option>)}</select></label>
          <label className="check"><input type="checkbox" checked={f.includeExcluded} onChange={e=>update({includeExcluded:e.target.checked})}/><span>Include excluded<br/>&amp; unmapped</span></label><button className="text-button" onClick={reset}>Reset</button>
        </fieldset>
        <p className="scope-note">Financial totals use month and agency filters. Brand, product and inclusion filters apply to product analytics only.</p>
        {loading && <div className="message" role="status">Updating your view…</div>}
        {!!data.warnings.length && <div className="warnings">{data.warnings.map(w=><p key={w}>{w}</p>)}</div>}
        <div id="dashboard" aria-busy={loading}>
          <div className="section-heading"><h2>Performance at a glance</h2><span className="period-label">{f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end)} · {f.agency||'All agencies'}</span></div>
          <section className="kpi-grid" aria-label="Financial performance">{[['Primary sales','primary','Purchases by your agencies','primary-line'],['Secondary sales','secondary','Sales from your agencies','secondary-line'],['Closing stock','closing',monthLabel(f.end)+' closing balance','neutral-line']].map(([label,key,note,line])=><article className="kpi" key={key}><p>{label}<span>₹</span></p><strong title={exact(data.kpis[key],true)} aria-label={exact(data.kpis[key],true)}>{compact(data.kpis[key],true)}</strong><small>{note}</small><span className={'kpi-line '+line}/></article>)}<article className="kpi"><p>Secondary growth<span>↗</span></p><strong className={data.kpis.comparison.value==null?'':data.kpis.comparison.value<0?'negative':'positive'}>{data.kpis.comparison.value==null?'—':(data.kpis.comparison.value>0?'+':'')+data.kpis.comparison.value.toFixed(1)+'%'}</strong><small>{data.kpis.comparison.value==null?data.kpis.comparison.reason:'vs '+monthLabel(data.kpis.comparison.previousMonth)+' · comparable agencies'}</small><span className="kpi-line neutral-line"/></article></section>
          <div className="chart-grid financial-grid">
            <ChartPanel title="Primary vs secondary" subtitle={(f.start===f.end?'Up to 12 months through selection':'Selected monthly range')+' · ₹'} currency labels={t.months.map(monthLabel)} datasets={[{label:'Primary sales',data:t.financial.map(r=>r.primary)},{label:'Secondary sales',data:t.financial.map(r=>r.secondary)}]} onPoint={i=>openDrill({kind:'financial',month:t.months[i]})} columns={[{label:'Month',render:r=>productLink(monthLabel(r.month),()=>openDrill({kind:'financial',month:r.month}))},numeric('Primary ₹','primary',true),numeric('Secondary ₹','secondary',true),{label:'Coverage',render:r=>r.partial?'Partial / incomplete':'Full'}]} rows={t.financial}/>
            <ChartPanel title="Secondary by agency" subtitle="Agency contribution over time · ₹" currency type="bar" labels={t.months.map(monthLabel)} datasets={t.agency.map(s=>({label:s.name,data:s.values}))} onPoint={i=>openDrill({kind:'financial',month:t.months[i]})} columns={[{label:'Month',render:r=>monthLabel(r.month)},...t.agency.map((s,i)=>({label:s.name+' ₹',numeric:true,render:r=>exact(r.values[i],true)}))]} rows={t.months.map((month,i)=>({month,values:t.agency.map(s=>s.values[i])}))}/>
          </div>
          <section className="insights panel"><div className="insights-title"><span className="insight-icon" aria-hidden="true">✧</span><div><h2>What the numbers say</h2><p>Calculated from your selected data</p></div></div><ul>{(data.insights.length?data.insights:['No data available for the selected filters.']).map(s=><li key={s}>{s}</li>)}</ul></section>
          <div id="products" className="section-heading anchor"><div><p className="eyebrow">PRODUCT INTELLIGENCE</p><h2>Movement, mapped to your products</h2></div><span className="muted">{o.products.length} available products · {f.includeExcluded?'all inclusion flags':'Include_In_Charts = YES'}</span></div>
          <div className="chart-grid">
            <ChartPanel title="Top products by units sold" subtitle="Top 10 · selected period · normalized products" type="bar" horizontal labels={data.topProducts.map(r=>r.name)} datasets={[{label:'Units sold',data:data.topProducts.map(r=>r.units)}]} onPoint={i=>openDrill({productKey:data.topProducts[i].key})} columns={[{label:'Product',render:r=>productLink(r.name,()=>openDrill({productKey:r.key}))},{label:'SKU',key:'sku'},numeric('Units sold','units')]} rows={data.topProducts}/>
            <ChartPanel title="Product sales trend" subtitle="Monthly units sold, split by agency" labels={t.months.map(monthLabel)} datasets={t.product.map(s=>({label:s.name,data:s.values}))} onPoint={i=>openDrill({productKey:t.productKey,month:t.months[i]})} columns={[{label:'Month',render:r=>productLink(monthLabel(r.month),()=>openDrill({productKey:t.productKey,month:r.month}))},...t.product.map((s,i)=>({label:s.name+' units',numeric:true,render:r=>exact(r.values[i])}))]} rows={t.months.map((month,i)=>({month,values:t.product.map(s=>s.values[i])}))}><label className="trend-picker">Product to explore<select disabled={!!f.product || loading} value={f.product || f.trendProduct} onChange={e=>update({trendProduct:e.target.value})}>{o.products.map(p=><option value={p.key} key={p.key}>{p.name}</option>)}</select></label></ChartPanel>
          </div>
          <div id="inventory" className="section-heading anchor"><div><p className="eyebrow">INVENTORY INTELLIGENCE</p><h2>Know where your stock stands</h2></div><span className="muted">Snapshot · {monthLabel(f.end)}</span></div>
          <div className="chart-grid inventory-grid">
            <ChartPanel title="Closing stock by product" subtitle="Top 10 by closing inventory value · ₹" type="bar" horizontal currency labels={data.inventory.map(r=>r.name)} datasets={[{label:'Closing stock',data:data.inventory.map(r=>r.value)}]} onPoint={i=>openDrill({productKey:data.inventory[i].key,month:f.end})} columns={[{label:'Product',render:r=>productLink(r.name,()=>openDrill({productKey:r.key,month:f.end}))},numeric('QOH','qoh'),numeric('Closing stock ₹','value',true)]} rows={data.inventory}/>
            <article className="panel"><div className="panel-header"><div><h2>Slow / no movement candidates</h2><p>Positive closing quantity · individual stock observations</p></div><span className="count">{data.candidateCount}</span></div><form className="thresholds" onSubmit={e=>{e.preventDefault();update({maxUnits:maxUnits===''?0:Number(maxUnits),minAge:minAge===''?null:Number(minAge)});}}><label>Units sold ≤<input type="number" min="0" step="any" value={maxUnits} onChange={e=>setMaxUnits(e.target.value)}/></label><label>Stock age ≥<input type="number" min="0" step="any" placeholder="Any" value={minAge} onChange={e=>setMinAge(e.target.value)}/></label><button type="submit" className="button" disabled={loading}>Apply</button></form><p className="scope-note">Age is shown as recorded in the sheet; its unit is not assumed.</p><div className="candidates"><DataTable columns={[{label:'Product / Agency',render:r=><>{productLink(r.productName,()=>openDrill({productKey:r.productKey,month:f.end}))}<div className="muted">{r.agency}</div></>},numeric('QOH','qoh'),numeric('Units','units'),numeric('Age','age'),numeric('Closing ₹','value',true)]} rows={data.candidates} empty="No candidates match these thresholds."/></div><button className="text-button footer-link" onClick={()=>openDrill({kind:'candidates'})}>{data.candidateCount>25?'Showing 25 of '+data.candidateCount+' · ':''}Explore candidate source rows →</button></article>
          </div>
          <section className="ask panel"><div><span className="tag">NEXT UP</span><h2>Ask your sales data</h2><p>A place for your next question. Guided exploration is available now.</p></div><div className="ask-control"><input aria-label="Future natural-language questions" placeholder="e.g. Compare ACN 1000 sales between Madhu and Meda" disabled/><div className="ask-bottom"><span>Natural-language queries are planned for a future version.</span><a className="text-button" href="#products">Explore product trends ↗</a></div></div></section>
          <details className="diagnostics panel"><summary><span>Data quality &amp; traceability</span><span className="muted">Source coverage, mappings and exclusions</span></summary><div className="diagnostic-grid">{[['Latest statement month',monthLabel(q.latestMonth)],['Agencies loaded',q.agencies.join(', ')||'—'],['Raw names · all data',q.rawNames],['Normalized SKUs · all data',q.skus],['Unmapped names · selected scope',q.unmappedRawCount],['Rows excluded: NO · scope',q.excludedNo],['Other non-YES rows · scope',q.excludedOther],['Raw observations · all data',q.rawRows]].map(([label,value])=><div key={label}><p>{label}</p><strong>{value}</strong></div>)}</div><p className="scope-note">Selected scope = month range + agency, before brand/product/inclusion filters. Each refresh reads the live sheet using your Google access. Missing observations remain unavailable, not invented zeros.</p><div className="diagnostic-actions"><button className="button" onClick={()=>openDrill()}>Inspect product source rows</button><button className="button" onClick={()=>openDrill({kind:'financial'})}>Inspect financial statements</button></div><h3>Unmapped aliases in selected scope</h3><DataTable columns={[{label:'Raw name',key:'rawName'},{label:'Agency',key:'agency'},{label:'Mapping issue',key:'issue'}]} rows={q.unmapped} empty="All raw names in this scope have an exact, unambiguous mapping."/></details>
        </div>
      </>}
      <footer><span>MedMetric <span className="footer-dot">/</span> Clarity in every number.</span><span>Google Sheets source · Read-only · No AI-generated insights</span></footer>
    </main>
    <dialog ref={dialog} onCancel={()=>setDrill(null)} aria-labelledby="drill-title"><div className="dialog-header"><div><p className="eyebrow">TRACE THE NUMBERS</p><h2 id="drill-title">{financial?'Financial statements':'Product source rows'}</h2></div><button className="button" onClick={()=>setDrill(null)}>Close ✕</button></div><p role="status">{drillError || (!drillData?'Reading source rows…':'Original source names preserved. Sale is units; Value is closing inventory value.')}</p><div id="drill-table"><DataTable columns={drillColumns} rows={drillData?.rows || []}/></div><div className="pagination"><button className="button" disabled={!drillData || !drillData.offset} onClick={()=>setDrill(r=>({...r,offset:Math.max(0,r.offset-50)}))}>← Previous</button><span>{drillData?.total?`${drillData.offset+1}–${Math.min(drillData.offset+50,drillData.total)} of ${drillData.total}`:'0 rows'}</span><button className="button" disabled={!drillData || drillData.offset+50>=drillData.total} onClick={()=>setDrill(r=>({...r,offset:r.offset+50}))}>Next →</button></div></dialog>
  </>;
}
