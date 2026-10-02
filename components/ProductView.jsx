'use client';
import {useState} from 'react';
import { sharedValueRange } from '../lib/chart-scales.js';
import ChartPanel, { compact, exact, monthLabel, percentage } from './ChartPanel.jsx';

function MetricCard({label,value,unit,note,agencies,onAgency,colors,readValue,shareKey,formatValue,formatTotal,reason}) {
  return <article className="kpi product-metric"><p>{label}<span>{unit}</span></p><strong title={formatValue(value)}>{(formatTotal||formatValue)(value)}</strong><small>{note}</small>{value==null&&reason&&<div className="metric-explanation">{reason}</div>}<ul className="metric-agencies">{agencies.map(a=>{
    const item=readValue(a),share=shareKey?a.shares[shareKey]:null;
    return <li key={a.agency}><button type="button" onClick={()=>onAgency(a.agency)} aria-label={'Explore '+a.agency+' '+label.toLowerCase()}><span className="metric-agency-name"><i style={{background:colors(a.agency)}} aria-hidden="true"/>{a.agency}</span><span className="metric-agency-values"><b>{formatValue(item.value)}</b>{item.reason&&<span>{item.reason}</span>}{share!=null&&<span>{share.toLocaleString('en-IN',{maximumFractionDigits:1})}% of total</span>}</span></button></li>;
  })}</ul><span className="kpi-line primary-line"/></article>;
}

export default function ProductView({data,onSource,onAgency,showInsights=true}) {
  const [section,setSection]=useState('analysis');
  const product=data.productDetail, monthly=product.monthly, f=data.filters;
  const labels=monthly.months.map(monthLabel);
  const agencyColor=agency=>['#3489e0','#e65722'][data.options.agencies.indexOf(agency)%2];
  const unitValue=value=>value==null?'—':exact(value)+' units';
  const stockMonths=value=>value==null?'—':value>0&&value<0.1?'<0.1 months':exact(value)+' months';
  const signedUnits=value=>value==null?'—':(value>0?'+':'')+exact(value)+' units';
  const valueRange=sharedValueRange(monthly.agencies.flatMap(series=>series.rows.flatMap(row=>[row.purchased,row.units])));
  const fullStockMonths=monthly.agencies.every(series=>series.rows.every(row=>!row.observations||row.coverage==='Full month'));
  const monthlyColumns=[{label:'Month',render:r=><button type="button" onClick={()=>onSource({productKey:product.key,month:r.month})}>{monthLabel(r.month)}</button>},...[['Restocked units','purchased'],['Sold units','units']].map(([label,key])=>({label,numeric:true,render:r=>exact(r[key])}))];
  const agencyColumns=[{label:'Agency',render:r=><button type="button" onClick={()=>onAgency(r.agency)}>{r.agency}</button>},
    ...[['Units sold','units',false],['Units received','purchased',false],['Closing units','qoh',false],['Stock value ₹','value',true]].map(([label,key,currency])=>({label,numeric:true,render:r=>exact(r[key],currency)})),
    {label:'Latest month vs prior',numeric:true,render:r=>r.growth==null?'—':<span className={r.growth<0?'negative':'positive'}>{percentage(r.growth)}</span>}];
  return <section id="product-detail" aria-label={`${product.name} product analysis`}>
    <div className="product-context"><div className="product-tags">{[product.brand,product.sku && 'SKU '+product.sku,...product.statuses].filter(Boolean).map(tag=><span key={tag}>{tag}</span>)}</div><button className="button" onClick={()=>onSource({productKey:product.key})}>View source rows ↗</button></div>
    <nav className="product-report-tabs" aria-label="Product analysis views">{[['analysis','Analysis & charts'],['agencies','Agency comparison']].map(([key,label])=><button type="button" key={key} aria-pressed={section===key} onClick={()=>setSection(key)}>{label}</button>)}</nav>
    <div hidden={section!=='analysis'}><div className="section-heading"><h2>Product performance</h2><span className="period-label">{f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end)} · {f.agency||'All agencies'}</span></div>
    <section className="kpi-grid" aria-label="Product metrics">{[
      ['Units sold','units',false,'Selected period'],['Units restocked','purchased',false,'Selected period'],
      ['Closing stock','qoh',false,'Units remaining · '+monthLabel(f.end)],['Stock value','value',true,'Closing inventory · '+monthLabel(f.end)]
    ].map(([label,key,currency,note])=><MetricCard key={key} label={label} value={product.metrics[key]} unit={currency?'₹':'units'} note={note} agencies={product.agencies} onAgency={onAgency} colors={agencyColor} shareKey={key}
      readValue={a=>({value:a[key],reason:a[key]==null?'Missing data':''})} formatValue={currency?value=>exact(value,true):unitValue} formatTotal={value=>compact(value,currency)} reason="Some agency data is missing; available values are shown below."/>)}</section>
    <div className="chart-grid product-summary-charts">
      <ChartPanel title="Monthly sales by agency" subtitle={(labels[0]||'—')+' – '+(labels.at(-1)||'—')+' · sold units · missing observations remain gaps'} unit="Units" labels={labels}
        datasets={monthly.agencies.map(series=>({label:series.agency,data:series.rows.map(row=>row.units),color:agencyColor(series.agency)}))}
        coverage={monthly.months.map((_,i)=>monthly.agencies.map(series=>series.agency+': '+series.rows[i].coverage).join(' · '))}
        takeaway={showInsights?monthly.agencies.map(series=>{const last=series.rows.at(-1);return last?.units==null?series.agency+': sales are unavailable for '+monthLabel(f.end)+'.':series.agency+': '+exact(last.units)+' units sold in '+monthLabel(f.end)+' ('+last.coverage.toLowerCase()+').';}):null}
        onPoint={i=>onSource({productKey:product.key,month:monthly.months[i]})} interactionHint="Select a month to inspect its source rows."
        columns={[monthlyColumns[0],...monthly.agencies.map((series,i)=>({label:series.agency+' sold units',numeric:true,render:row=>exact(row.values[i])})),{label:'Coverage',render:row=>monthly.agencies.map(series=>series.agency+': '+series.rows[row.index].coverage).join(' · ')}]}
        rows={monthly.months.map((month,i)=>({month,index:i,values:monthly.agencies.map(series=>series.rows[i].units)}))}/>
    <div className="product-stock-chart">
      <ChartPanel title={(fullStockMonths?'Month-end stock on hand: ':'Statement closing stock: ')+product.name} subtitle={fullStockMonths?'Units remaining at each month end · compare agencies':'Closing units by statement month · partial statements may end before month-end'} unit="Units" labels={labels} takeaway={showInsights?monthly.stockTakeaways:null} coverage={monthly.months.map((_,i)=>monthly.agencies.map(series=>series.agency+': '+series.rows[i].coverage).join(' · '))}
        datasets={monthly.agencies.map(series=>({label:series.agency,data:series.rows.map(r=>r.qoh),color:['#3489e0','#e65722'][data.options.agencies.indexOf(series.agency)%2]}))}
        onPoint={i=>onSource({productKey:product.key,month:monthly.months[i]})} interactionHint="Select a month to inspect its stock observations. Gaps mean the observation is missing."
        columns={[monthlyColumns[0],...monthly.agencies.map((series,i)=>({label:series.agency+' stock units',numeric:true,render:r=>exact(r.values[i])})),{label:'Coverage',render:r=>monthly.agencies.map(series=>series.agency+': '+series.rows[r.index].coverage).join(' · ')}]}
        rows={monthly.months.map((month,i)=>({month,index:i,values:monthly.agencies.map(series=>series.rows[i].qoh)}))}/>
    </div>
    </div>
    {showInsights&&<section className="insights panel product-insights"><div className="insights-title"><span className="insight-icon" aria-hidden="true">✧</span><div><h2>Trends &amp; agency insights</h2><p>Calculated only from {product.name} observations</p></div></div><ul>{(product.insights.length?product.insights:['No product insights available for this selection.']).map(text=><li key={text}>{text}</li>)}</ul></section>}
    <details className="additional-analysis product-restocking"><summary>Restocked vs sold · monthly detail by agency</summary>
    <div className="chart-grid product-monthly-charts">
      {monthly.agencies.map(series=><ChartPanel key={series.agency} title={series.agency+': '+product.name+' — restocked vs sold'} subtitle="Monthly units · blue = restocked · orange = sold · common scale across agencies" type="bar" unit="Units" labels={labels} valueRange={valueRange} takeaway={showInsights?series.takeaway:null} coverage={series.rows.map(r=>r.coverage)}
        datasets={[{label:'Restocked',data:series.rows.map(r=>r.purchased),color:'#3489e0'},{label:'Sold',data:series.rows.map(r=>r.units),color:'#e65722'}]}
        onPoint={i=>onSource({productKey:product.key,month:monthly.months[i],agency:series.agency})} interactionHint="Select a month to inspect this agency’s source rows. Missing observations appear as gaps or —."
        columns={[{...monthlyColumns[0],render:r=><button type="button" onClick={()=>onSource({productKey:product.key,month:r.month,agency:series.agency})}>{monthLabel(r.month)}</button>},...monthlyColumns.slice(1),{label:'Coverage',key:'coverage'}]} rows={series.rows}/>)}
    </div>
    </details>
    <details className="additional-analysis"><summary>Growth, receipt/sales gap & stock cover</summary>
    <section className="product-extra-metrics" aria-label="Product growth and stock coverage">
      <MetricCard label="Latest-month sales growth" value={product.latestGrowth} unit="%" note={monthLabel(f.end)+' vs '+monthLabel(product.previousMonth)} agencies={product.agencies} onAgency={onAgency} colors={agencyColor} readValue={a=>({value:a.growth,reason:a.growthReason})} formatValue={percentage} reason={product.latestGrowthReason}/>
      <MetricCard label="Restocked − sold" value={product.metrics.restockingGap} unit="units" note="Selected period · receipts minus sales" agencies={product.agencies} onAgency={onAgency} colors={agencyColor} readValue={a=>({value:a.restockingGap,reason:a.restockingGap==null?'Missing data':''})} formatValue={signedUnits} reason="Needs complete restocking and sales data."/>
      <MetricCard label="Estimated stock cover" value={product.metrics.stockCoverage.value} unit="months" note={'Closing stock ÷ units sold in '+monthLabel(f.end)} agencies={product.agencies} onAgency={onAgency} colors={agencyColor} readValue={a=>a.stockCoverage} formatValue={stockMonths} reason={product.metrics.stockCoverage.reason}/>
    </section>
    <p className="product-metric-note">Select an agency in any card to focus the product view. Percentages use complete, comparable data. Restocked − sold is a receipt/sales gap, not the change in closing stock. Stock cover assumes the latest full-month sales pace continues; it is an estimate.</p>
    </details></div>
<div hidden={section!=='agencies'} className="product-agency-comparison">
    <ChartPanel title="Agency sales & restocking" subtitle={'Units during '+(f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end))} type="bar" horizontal labels={product.agencies.map(row=>row.agency)} datasets={[{label:'Sold units',data:product.agencies.map(row=>row.units),color:'#3489e0'},{label:'Restocked units',data:product.agencies.map(row=>row.purchased),color:'#e65722'}]} onPoint={i=>onAgency(product.agencies[i].agency)} columns={agencyColumns} rows={product.agencies} takeaway={showInsights?product.agencies.map(row=>row.agency+': '+exact(row.units)+' units sold, '+exact(row.purchased)+' restocked; '+exact(row.qoh)+' closing units at '+monthLabel(f.end)+'.'):null}/>
    </div>
  </section>;
}
