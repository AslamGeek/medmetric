'use client';
import ChartPanel, { compact, exact, monthLabel, DataTable } from './ChartPanel.jsx';

export default function ProductView({data,onSource,onAgency}) {
  const product=data.productDetail, monthly=product.monthly, f=data.filters;
  const labels=monthly.months.map(monthLabel);
  const monthlyColumns=[{label:'Month',render:r=><button type="button" onClick={()=>onSource({productKey:product.key,month:r.month})}>{monthLabel(r.month)}</button>},...[['Restocked units','purchased'],['Sold units','units']].map(([label,key])=>({label,numeric:true,render:r=>exact(r[key])}))];
  const agencyColumns=[{label:'Agency',render:r=><button type="button" onClick={()=>onAgency(r.agency)}>{r.agency}</button>},
    ...[['Units sold','units',false],['Units received','purchased',false],['Closing units','qoh',false],['Stock value ₹','value',true]].map(([label,key,currency])=>({label,numeric:true,render:r=>exact(r[key],currency)})),
    {label:'Latest month vs prior',numeric:true,render:r=>r.growth==null?'—':<span className={r.growth<0?'negative':'positive'}>{r.growth>0?'+':''}{r.growth.toFixed(1)}%</span>}];
  return <section id="product-detail" aria-label={`${product.name} product analysis`}>
    <div className="product-context"><div className="product-tags">{[product.brand,product.sku && 'SKU '+product.sku,...product.statuses].filter(Boolean).map(tag=><span key={tag}>{tag}</span>)}</div><button className="button" onClick={()=>onSource({productKey:product.key})}>View source rows ↗</button></div>
    <div className="section-heading"><h2>Product performance</h2><span className="period-label">{f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end)} · {f.agency||'All agencies'}</span></div>
    <section className="kpi-grid" aria-label="Product metrics">{[
      ['Units sold','units',false,'Selected period'],['Units received','purchased',false,'Agency purchases · selected period'],
      ['Closing stock','qoh',false,'Units remaining · '+monthLabel(f.end)],['Stock value','value',true,'Closing inventory · '+monthLabel(f.end)]
    ].map(([label,key,currency,note])=><article className="kpi" key={key}><p>{label}<span>{currency?'₹':'units'}</span></p><strong title={exact(product.metrics[key],currency)}>{compact(product.metrics[key],currency)}</strong><small>{note}</small><span className="kpi-line primary-line"/></article>)}</section>
    <section className="insights panel product-insights"><div className="insights-title"><span className="insight-icon" aria-hidden="true">✧</span><div><h2>Trends &amp; agency insights</h2><p>Calculated only from {product.name} observations</p></div></div><ul>{(product.insights.length?product.insights:['No product insights available for this selection.']).map(text=><li key={text}>{text}</li>)}</ul></section>
    <div className="section-heading"><h2>Restocked vs sold</h2><span className="period-label">Monthly units · {labels[0] || '—'} to {labels.at(-1) || '—'}</span></div>
    <div className="chart-grid product-monthly-charts">
      {monthly.agencies.map(series=><ChartPanel key={series.agency} title={series.agency+': '+product.name+' — restocked vs sold'} subtitle="Units · blue = restocked · orange = sold" type="bar" unit="Units" labels={labels}
        datasets={[{label:'Restocked',data:series.rows.map(r=>r.purchased),color:'#3489e0'},{label:'Sold',data:series.rows.map(r=>r.units),color:'#e65722'}]}
        onPoint={i=>onSource({productKey:product.key,month:monthly.months[i],agency:series.agency})} interactionHint="Select a month to inspect this agency’s source rows. Missing observations appear as gaps or —."
        columns={[{...monthlyColumns[0],render:r=><button type="button" onClick={()=>onSource({productKey:product.key,month:r.month,agency:series.agency})}>{monthLabel(r.month)}</button>},...monthlyColumns.slice(1)]} rows={series.rows}/>)}
    </div>
    <div className="product-stock-chart">
      <ChartPanel title={'Month-end stock on hand: '+product.name} subtitle="Units remaining at each month end · compare agencies" unit="Units" labels={labels}
        datasets={monthly.agencies.map(series=>({label:series.agency,data:series.rows.map(r=>r.qoh),color:['#3489e0','#e65722'][data.options.agencies.indexOf(series.agency)%2]}))}
        onPoint={i=>onSource({productKey:product.key,month:monthly.months[i]})} interactionHint="Select a month to inspect its stock observations. Gaps mean the observation is missing."
        columns={[monthlyColumns[0],...monthly.agencies.map((series,i)=>({label:series.agency+' stock units',numeric:true,render:r=>exact(r.values[i])}))]}
        rows={monthly.months.map((month,i)=>({month,values:monthly.agencies.map(series=>series.rows[i].qoh)}))}/>
    </div>
    <article className="panel product-agencies"><div className="panel-header"><div><h2>Agency sales &amp; stock</h2><p>Sales and receipts cover the selected period. Closing stock is the {monthLabel(f.end)} snapshot.</p></div><span className="tag">{product.observations} source rows</span></div><DataTable columns={agencyColumns} rows={product.agencies}/><p>Growth compares {monthLabel(f.end)} with {monthLabel(product.previousMonth)} using complete statements. Missing observations are shown as —. Select an agency to focus this product’s analysis.</p></article>
  </section>;
}
