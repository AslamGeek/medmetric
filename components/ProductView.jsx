'use client';
import LiquidityBadge,{coverDays} from './LiquidityBadge.jsx';
import {displayCoverage} from '../lib/analytics.js';
import { sharedValueRange } from '../lib/chart-scales.js';
import ChartPanel, { compact, exact, monthLabel, percentage } from './ChartPanel.jsx';
import ProductPrices from './ProductPrices.jsx';
import {pricesForSku} from '../lib/product-prices.js';

function MetricCard({label,value,unit,note,agencies,onAgency,colors,readValue,shareKey,formatValue,formatTotal,reason}) {
  return <article className="kpi product-metric"><p>{label}<span>{unit}</span></p><strong title={formatValue(value)}>{(formatTotal||formatValue)(value)}</strong><small>{note}</small>{value==null&&reason&&<div className="metric-explanation">{reason}</div>}<ul className="metric-agencies">{agencies.map(a=>{
    const item=readValue(a),share=shareKey?a.shares[shareKey]:null;
    return <li key={a.agency}><button type="button" onClick={()=>onAgency(a.agency)} aria-label={'Explore '+a.agency+' '+label.toLowerCase()}><span className="metric-agency-name"><i style={{background:colors(a.agency)}} aria-hidden="true"/>{a.agency}</span><span className="metric-agency-values"><b>{formatValue(item.value)}</b>{item.reason&&<span>{item.reason}</span>}{share!=null&&<span>{share.toLocaleString('en-IN',{maximumFractionDigits:1})}% of total</span>}</span></button></li>;
  })}</ul><span className="kpi-line primary-line"/></article>;
}

export default function ProductView({data,onSource,onAgency}) {
  const product=data.productDetail, monthly=product.monthly, f=data.filters;
  const labels=monthly.months.map(monthLabel);
  const liquidity=data.liquidity.products.find(row=>row.key===product.key);
  const liquidAgencies=liquidity?.agencies||[];
  const liquidityFor=agency=>liquidAgencies.find(row=>row.agency===agency);
  const baseline=data.liquidity.months.map(monthLabel).join(' → ');
  const agencyColor=agency=>['#3489e0','#e65722'][data.options.agencies.indexOf(agency)%2];
  const unitValue=value=>value==null?'—':exact(value)+' units';
  const signedUnits=value=>value==null?'—':(value>0?'+':'')+exact(value)+' units';
  const valueRange=sharedValueRange(monthly.agencies.flatMap(series=>series.rows.flatMap(row=>[row.purchased,row.units,row.qoh])));
  const fullStockMonths=monthly.agencies.every(series=>series.rows.every(row=>!row.observations||row.coverage==='Full month'));
  const monthlyNotes=monthly.months.map((_,i)=>displayCoverage(monthly.agencies.map(series=>series.agency+': '+series.rows[i].coverage).join(' · ')));
  const noteColumns=monthlyNotes.some(Boolean)?[{label:'Data note',render:row=>monthlyNotes[row.index]||'—'}]:[];
  const monthlyDatasets=monthly.agencies.flatMap(series=>[
    {label:series.agency+' · Restocked',data:series.rows.map(row=>row.purchased),color:agencyColor(series.agency)+'80',type:'bar'},
    {label:series.agency+' · Sold',data:series.rows.map(row=>row.units),color:agencyColor(series.agency),type:'bar'},
    {label:series.agency+' · '+(fullStockMonths?'Month-end stock':'Statement closing stock'),data:series.rows.map(row=>row.qoh),color:agencyColor(series.agency),type:'line',borderDash:[5,4]}
  ]);
  const monthlyColumns=[{label:'Month',render:row=><button type="button" onClick={()=>onSource({productKey:product.key,month:row.month})}>{monthLabel(row.month)}</button>},...monthly.agencies.flatMap(series=>[['Restocked','purchased'],['Sold','units'],[fullStockMonths?'Month-end stock':'Statement closing stock','qoh']].map(([label,key])=>({
    label:series.agency+' · '+label,numeric:true,render:row=>series.rows[row.index][key]==null?'—':<button type="button" onClick={()=>onSource({productKey:product.key,month:row.month,agency:series.agency})}>{exact(series.rows[row.index][key])}</button>
  }))),...noteColumns];
  return <section id="product-detail" aria-label={`${product.name} product analysis`}>
    <ProductPrices productName={product.name} prices={pricesForSku(data.prices,product.sku)} status={data.priceStatus}/>
    <div className="section-heading"><h2>Performance</h2><span className="period-label">{f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end)} · {f.agency||'All agencies'}</span></div>
    <section className="kpi-grid" aria-label="Product metrics">{[
      ['Units sold','units',false,'Selected period'],['Units restocked','purchased',false,'Selected period'],
      ['Closing stock','qoh',false,'Units remaining · '+monthLabel(f.end)],['Stock value','value',true,'Closing inventory · '+monthLabel(f.end)]
    ].map(([label,key,currency,note])=><MetricCard key={key} label={label} value={product.metrics[key]} unit={currency?'₹':'units'} note={note} agencies={product.agencies} onAgency={onAgency} colors={agencyColor} shareKey={key}
      readValue={a=>({value:a[key],reason:a[key]==null?'Missing data':''})} formatValue={currency?value=>exact(value,true):unitValue} formatTotal={value=>compact(value,currency)} reason="Some agency data is missing; available values are shown below."/>)}</section>
    <section className="product-growth-section" aria-labelledby="product-growth-title">
      <div className="section-heading"><h2 id="product-growth-title">Growth &amp; stock cover</h2></div>
      <div className="product-extra-metrics">
        <MetricCard label="Latest-month sales growth" value={product.latestGrowth} unit="%" note={monthLabel(f.end)+' vs '+monthLabel(product.previousMonth)} agencies={product.agencies} onAgency={onAgency} colors={agencyColor} readValue={a=>({value:a.growth,reason:a.growthReason})} formatValue={percentage} reason={product.latestGrowthReason}/>
        <MetricCard label="Restocked − sold" value={product.metrics.restockingGap} unit="units" note="Selected period · receipts minus sales" agencies={product.agencies} onAgency={onAgency} colors={agencyColor} readValue={a=>({value:a.restockingGap,reason:a.restockingGap==null?'Missing data':''})} formatValue={signedUnits} reason="Needs complete restocking and sales data."/>
        <MetricCard label="Stock cover (3-month pace)" value={liquidity?.daysOfCover??null} unit="days" note={baseline} agencies={product.agencies} onAgency={onAgency} colors={agencyColor} readValue={a=>({value:liquidityFor(a.agency)?.daysOfCover??null,reason:liquidityFor(a.agency)?.reason||liquidityFor(a.agency)?.label||''})} formatValue={coverDays} reason={liquidity?.reason}/>
      </div>
      <div className="product-cover-context"><LiquidityBadge value={liquidity}/><span>{baseline} · {data.liquidity.days} calendar days</span></div>
      <p className="product-metric-note">Restocked − sold measures receipts minus sales for the selected period. Stock cover estimates days of stock at the last three months’ average daily sales pace. Growth uses comparable full-month data. Select an agency in a card to focus the view.</p>
    </section>
    <section className="product-monthly-analysis" aria-label="Monthly sales and stock">
      <ChartPanel title="Monthly sales & stock" subtitle={(labels[0]||'—')+' – '+(labels.at(-1)||'—')+' · restocked and sold: bars · '+(fullStockMonths?'month-end stock':'statement closing stock')+': dashed lines'} type="bar" unit="Units" labels={labels} valueRange={valueRange} datasets={monthlyDatasets} coverage={monthlyNotes} selectDataset
        onPoint={(i,datasetIndex)=>onSource({productKey:product.key,month:monthly.months[i],agency:monthly.agencies[Math.floor(datasetIndex/3)].agency})}
        interactionHint="Select a bar or stock point to inspect that agency’s source rows. Missing observations remain gaps."
        columns={monthlyColumns} rows={monthly.months.map((month,index)=>({month,index}))}/>
    </section>
    <div className="product-source-actions"><button className="text-button" onClick={()=>onSource({productKey:product.key})}>View source rows ↗</button></div>
  </section>;
}
