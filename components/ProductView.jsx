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

export default function ProductView({data,onSource,onAgency,showInsights=true}) {
  const product=data.productDetail, monthly=product.monthly, f=data.filters;
  const labels=monthly.months.map(monthLabel);
  const liquidity=data.liquidity.products.find(row=>row.key===product.key);
  const liquidAgencies=liquidity?.agencies||[];
  const liquidityFor=agency=>liquidAgencies.find(row=>row.agency===agency);
  const baseline=data.liquidity.months.map(monthLabel).join(' → ');
  const agencyColor=agency=>['#3489e0','#e65722'][data.options.agencies.indexOf(agency)%2];
  const unitValue=value=>value==null?'—':exact(value)+' units';
  const signedUnits=value=>value==null?'—':(value>0?'+':'')+exact(value)+' units';
  const valueRange=sharedValueRange(monthly.agencies.flatMap(series=>series.rows.flatMap(row=>[row.purchased,row.units])));
  const fullStockMonths=monthly.agencies.every(series=>series.rows.every(row=>!row.observations||row.coverage==='Full month'));
  const monthlyNotes=monthly.months.map((_,i)=>displayCoverage(monthly.agencies.map(series=>series.agency+': '+series.rows[i].coverage).join(' · ')));
  const noteColumns=monthlyNotes.some(Boolean)?[{label:'Data note',render:row=>monthlyNotes[row.index]||'—'}]:[];
  const monthlyColumns=[{label:'Month',render:r=><button type="button" onClick={()=>onSource({productKey:product.key,month:r.month})}>{monthLabel(r.month)}</button>},...[['Restocked units','purchased'],['Sold units','units']].map(([label,key])=>({label,numeric:true,render:r=>exact(r[key])}))];
  const restockingDatasets=monthly.agencies.flatMap(series=>[
    {label:series.agency+' · Restocked',data:series.rows.map(row=>row.purchased),color:agencyColor(series.agency)+'80'},
    {label:series.agency+' · Sold',data:series.rows.map(row=>row.units),color:agencyColor(series.agency)}
  ]);
  const restockingColumns=[monthlyColumns[0],...monthly.agencies.flatMap(series=>[['Restocked','purchased'],['Sold','units']].map(([label,key])=>({
    label:series.agency+' · '+label,numeric:true,render:row=>series.rows[row.index][key]==null?'—':<button type="button" onClick={()=>onSource({productKey:product.key,month:row.month,agency:series.agency})}>{exact(series.rows[row.index][key])}</button>
  }))),...noteColumns];
  const agencyColumns=[{label:'Agency',render:r=><button type="button" onClick={()=>onAgency(r.agency)}>{r.agency}</button>},
    ...[['Units sold','units',false],['Units received','purchased',false],['Closing units','qoh',false],['Stock value ₹','value',true]].map(([label,key,currency])=>({label,numeric:true,render:r=>exact(r[key],currency)})),
    {label:'Latest month vs prior',numeric:true,render:r=>r.growth==null?'—':<span className={r.growth<0?'negative':'positive'}>{percentage(r.growth)}</span>}];
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
    <section className="product-restocking" aria-labelledby="product-restocking-title">
      <div className="section-heading"><h2 id="product-restocking-title">Monthly restocked vs sold</h2><span className="period-label">{labels[0]||'—'} – {labels.at(-1)||'—'}</span></div>
      <div className="product-monthly-charts">
        <ChartPanel title="Restocked and sold by agency" subtitle="Monthly units · light bars: restocked · solid bars: sold" type="bar" unit="Units" labels={labels} valueRange={valueRange} datasets={restockingDatasets} coverage={monthlyNotes} selectDataset
          takeaway={showInsights?monthly.agencies.map(series=>series.agency+': '+series.takeaway):null}
          onPoint={(i,datasetIndex)=>onSource({productKey:product.key,month:monthly.months[i],agency:monthly.agencies[Math.floor(datasetIndex/2)].agency})} interactionHint="Select a bar to inspect that agency’s source rows for the month. Missing observations appear as gaps or —."
          columns={restockingColumns} rows={monthly.months.map((month,index)=>({month,index}))}/>
      </div>
    </section>
    <div className="section-heading product-history-heading"><h2>Sales &amp; stock history</h2></div>
    <div className="chart-grid product-summary-charts">
      <ChartPanel title="Monthly sales by agency" subtitle={(labels[0]||'—')+' – '+(labels.at(-1)||'—')+' · sold units · missing observations remain gaps'} unit="Units" labels={labels}
        datasets={monthly.agencies.map(series=>({label:series.agency,data:series.rows.map(row=>row.units),color:agencyColor(series.agency)}))}
        coverage={monthlyNotes}
        takeaway={showInsights?monthly.agencies.map(series=>{const last=series.rows.at(-1);return last?.units==null?series.agency+': sales are unavailable for '+monthLabel(f.end)+'.':series.agency+': '+exact(last.units)+' units sold in '+monthLabel(f.end)+(displayCoverage(last.coverage)?' ('+displayCoverage(last.coverage).toLowerCase()+')':'')+'.';}):null}
        onPoint={i=>onSource({productKey:product.key,month:monthly.months[i]})} interactionHint="Select a month to inspect its source rows."
        columns={[monthlyColumns[0],...monthly.agencies.map((series,i)=>({label:series.agency+' sold units',numeric:true,render:row=>exact(row.values[i])})),...noteColumns]}
        rows={monthly.months.map((month,i)=>({month,index:i,values:monthly.agencies.map(series=>series.rows[i].units)}))}/>
    <div className="product-stock-chart">
      <ChartPanel title={fullStockMonths?'Month-end stock on hand':'Statement closing stock'} subtitle={fullStockMonths?'Units remaining at each month end · compare agencies':'Closing units by statement month · partial statements may end before month-end'} unit="Units" labels={labels} takeaway={showInsights?monthly.stockTakeaways:null} coverage={monthly.months.map((_,i)=>monthly.agencies.map(series=>series.agency+': '+series.rows[i].coverage).join(' · '))}
        datasets={monthly.agencies.map(series=>({label:series.agency,data:series.rows.map(r=>r.qoh),color:['#3489e0','#e65722'][data.options.agencies.indexOf(series.agency)%2]}))}
        onPoint={i=>onSource({productKey:product.key,month:monthly.months[i]})} interactionHint="Select a month to inspect its stock observations. Gaps mean the observation is missing."
        columns={[monthlyColumns[0],...monthly.agencies.map((series,i)=>({label:series.agency+' stock units',numeric:true,render:r=>exact(r.values[i])})),...noteColumns]}
        rows={monthly.months.map((month,i)=>({month,index:i,values:monthly.agencies.map(series=>series.rows[i].qoh)}))}/>
    </div>
    </div>
    <div className="section-heading product-history-heading"><h2>Agency comparison</h2></div>
    <div className="product-agency-comparison">
    <ChartPanel title="Agency sales & restocking" subtitle={'Units during '+(f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end))} type="bar" horizontal labels={product.agencies.map(row=>row.agency)} datasets={[{label:'Sold units',data:product.agencies.map(row=>row.units),color:'#3489e0'},{label:'Restocked units',data:product.agencies.map(row=>row.purchased),color:'#e65722'}]} onPoint={i=>onAgency(product.agencies[i].agency)} columns={agencyColumns} rows={product.agencies} takeaway={showInsights?product.agencies.map(row=>row.agency+': '+exact(row.units)+' units sold, '+exact(row.purchased)+' restocked; '+exact(row.qoh)+' closing units at '+monthLabel(f.end)+'.'):null}/>
        <ChartPanel title="Stock cover by agency" subtitle={'Closing stock: '+monthLabel(f.end)+' · sales pace: '+baseline} type="bar" horizontal unit="Days" labels={liquidAgencies.map(row=>row.agency)} datasets={[{label:'Estimated days of cover',data:liquidAgencies.map(row=>row.daysOfCover)}]} onPoint={i=>onAgency(liquidAgencies[i].agency)} columns={[{label:'Agency',render:row=><button onClick={()=>onAgency(row.agency)}>{row.agency}</button>},{label:'Category',render:row=><LiquidityBadge value={row}/>},{label:'Days of cover',numeric:true,render:row=>coverDays(row.daysOfCover)},{label:'Three-month sale units',numeric:true,render:row=>exact(row.units)},{label:'Closing units',numeric:true,render:row=>exact(row.qoh)},{label:'Data note',key:'reason'}]} rows={liquidAgencies} interactionHint="Non-moving and insufficient-data entries have no finite days-of-cover bar; their category is shown in the table and badges." takeaway={showInsights?liquidAgencies.map(row=>row.agency+': '+row.label+(row.daysOfCover!=null?' · '+coverDays(row.daysOfCover):'. '+row.reason)):null}/>
    </div>
    {showInsights&&<section className="insights panel product-insights"><div className="insights-title"><span className="insight-icon" aria-hidden="true">✧</span><div><h2>Trends &amp; agency insights</h2><p>Calculated only from {product.name} observations</p></div></div><ul>{(product.insights.length?product.insights:['No product insights available for this selection.']).map(text=><li key={text}>{text}</li>)}</ul></section>}
    <div className="product-source-actions"><button className="text-button" onClick={()=>onSource({productKey:product.key})}>View source rows ↗</button></div>
  </section>;
}
