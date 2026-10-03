'use client';
import {useState} from 'react';
import ChartPanel,{exact,monthLabel} from './ChartPanel.jsx';
import {selectProductRankings} from '../lib/product-rankings.js';

export default function ProductRankings({data,analysis,onSelect,mode='sales',onModeChange}){
  const [limit,setLimit]=useState(10),[condition,setCondition]=useState('zero'),[maxUnits,setMaxUnits]=useState('5'),[stockMetric,setStockMetric]=useState('value');
  const sales=mode==='sales',stockValue=stockMetric==='value',threshold=Math.max(0,Number(maxUnits)||0);
  const result=selectProductRankings(analysis,{limit,salesMetric:'units',movementScope:'agency',movementMode:condition,maxUnits:threshold,minStock:0,stockMetric});
  const rows=sales?result.top:result.nonMoving,count=sales?result.topCount:result.nonMovingCount;
  const f=data.filters,period=f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end);
  const metric=sales?'units':stockMetric,currency=!sales&&stockValue;
  const title=sales?'Best sellers':condition==='zero'?'Stock with zero sales':'Stock with low sales';
  const choose=row=>onSelect(row.productKey,sales?undefined:row.agency);
  const numeric=(label,key,money=false)=>({label,numeric:true,render:row=>exact(row[key],money)});
  const notes=[];
  if(sales&&result.incompleteProducts)notes.push(result.incompleteProducts+(result.incompleteProducts===1?' product has':' products have')+' incomplete sales coverage and '+(result.incompleteProducts===1?'is':'are')+' excluded from the ranking.');
  if(!sales&&result.unknownMovement)notes.push(result.unknownMovement+(result.unknownMovement===1?' product/agency pair has':' product/agency pairs have')+' incomplete sales coverage and cannot be classified as zero or low sales.');
  if(!sales&&result.unplottedMovement)notes.push(result.unplottedMovement+(result.unplottedMovement===1?' matching entry has':' matching entries have')+' no stock valuation. Select Stock units to include them.');
  return <section className="product-rankings explorer-priorities" aria-label="Product priorities">
    <div className="ranking-filters"><label>Explore<select value={mode} onChange={event=>onModeChange(event.target.value)}><option value="sales">Best sellers</option><option value="movement">Stock needing attention</option></select></label>
      {!sales&&<><label>Sales during this period<select value={condition} onChange={event=>setCondition(event.target.value)}><option value="zero">Zero sales</option><option value="slow">Low sales</option></select></label>{condition==='slow'&&<label>Units sold ≤<input type="number" min="0" step="any" value={maxUnits} onChange={event=>setMaxUnits(event.target.value)}/></label>}<label>Compare remaining stock by<select value={stockMetric} onChange={event=>setStockMetric(event.target.value)}><option value="value">Stock value ₹</option><option value="qoh">Stock units</option></select></label></>}
      <label>Show<select value={limit} onChange={event=>setLimit(Number(event.target.value))}>{[5,10,20].map(value=><option key={value} value={value}>Top {value}</option>)}</select></label>
    </div>
    <ChartPanel title={title} subtitle={'Showing '+rows.length+' of '+count+' · '+period+' · '+(f.agency||'All agencies')} type="bar" horizontal currency={currency} unit={currency?'₹':'Units'} chartHeight={Math.max(270,rows.length*34+80)} labels={rows.map(row=>row.name+(sales?'':' · '+row.agency))}
      datasets={[{label:sales?'Units sold':stockValue?'Remaining stock value':'Remaining stock units',data:rows.map(row=>row[metric]),color:sales?'#3489e0':'#e65722'}]}
      onPoint={index=>choose(rows[index])} interactionHint="Select a product to open its monthly sales and stock. The same search, category, period and agency filters apply throughout Product explorer."
      emptyText={sales?'No fully observed positive sales match these filters.':result.unplottedMovement?'Matching stock has no valuation. Compare by Stock units to see these entries.':'No confirmed stock matches this condition. Incomplete sales are not treated as zero.'}
      columns={[{label:'Product',render:row=><button type="button" onClick={()=>choose(row)}>{row.name}</button>},...(sales?[{label:'SKU',key:'sku'}]:[{label:'Agency',key:'agency'}]),numeric('Period units sold','units'),numeric('Closing units','qoh'),numeric('Closing stock ₹','value',true)]} rows={rows}>
      {!sales&&<p className="scope-note">Each entry identifies the agency holding stock at {monthLabel(f.end)}. {condition==='zero'?'Zero sales must be confirmed for the entire selected period.':'Low sales use the selected-period total.'}</p>}
      {notes.length>0&&<p className="scope-note" role="status">{notes.join(' ')}</p>}
    </ChartPanel>
  </section>;
}
