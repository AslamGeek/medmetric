'use client';
import { useState } from 'react';
import ChartPanel, {exact,monthLabel,percentage} from './ChartPanel.jsx';
import {selectProductRankings} from '../lib/product-rankings.js';
import ReportFilters from './ReportFilters.jsx';
import {patchReportFilters,resolveVisualFilters} from '../lib/report-filters.js';

const number=(value,fallback=0)=>value===''?fallback:Math.max(0,Number(value)||0);
const numeric=(label,key,currency=false)=>({label,numeric:true,render:row=>exact(row[key],currency)});

export default function ProductRankings({data,onSelect,model,mode='both',showInsights=true}) {
  const [topScope,setTopScope]=useState(null),[stockScope,setStockScope]=useState(null);
  const topData=topScope?model(resolveVisualFilters(data.filters,topScope)):data;
  const stockData=stockScope?model(resolveVisualFilters(data.filters,stockScope)):data;
  function scopeChange(current,patch,setScope) {
    const {start,end,agency,brand}=patchReportFilters(current,patch);
    setScope({start,end,agency,brand});
  }
  const [search,setSearch]=useState(''),[limit,setLimit]=useState(10),[salesMetric,setSalesMetric]=useState('estimatedValue');
  const [movementScope,setMovementScope]=useState('agency'),[movementMode,setMovementMode]=useState('zero');
  const [maxUnits,setMaxUnits]=useState('5'),[minStock,setMinStock]=useState('1'),[minAge,setMinAge]=useState(''),[stockMetric,setStockMetric]=useState('value');
  const result=selectProductRankings(topData.productAnalysis,{search,limit,salesMetric,movementScope,movementMode,maxUnits:number(maxUnits),minStock:number(minStock),minAge:minAge===''?null:number(minAge),stockMetric});
  const movement=selectProductRankings(stockData.productAnalysis,{search,limit,movementScope,movementMode,maxUnits:number(maxUnits),minStock:number(minStock),minAge:minAge===''?null:number(minAge),stockMetric});
  const periodLabel=f=>f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end);
  const f=stockData.filters,period=periodLabel(f),salesPeriod=periodLabel(topData.filters);
  const valueSales=salesMetric==='estimatedValue',stockValue=stockMetric==='value';
  const choose=row=>onSelect(row.productKey,movementScope==='agency'?row.agency:undefined,stockData.filters);
  const productColumn={label:'Product',render:row=><button type="button" onClick={()=>onSelect(row.productKey,undefined,topData.filters)}>{row.name}</button>};
  const topInsights=[];
  if(result.top[0])topInsights.push(result.top[0].name+' leads with '+exact(result.top[0][salesMetric],valueSales)+(valueSales?' estimated value':' units sold')+' ('+percentage(result.top[0][salesMetric]/result.salesTotal*100).replace('+','')+' of '+(valueSales?'products with available estimates':'ranked unit sales')+').');
  if(valueSales)topInsights.push('Estimate = each row’s units sold × (closing stock value ÷ closing units), then summed over the period. Stock valuation can differ from selling price; this is not actual sales revenue.');
  if(valueSales&&result.unavailableValue)topInsights.push(result.unavailableValue+' selling products have no complete estimate, often because closing stock is zero or a valuation is missing. Switch to Units sold to include them.');
  if(result.incompleteProducts)topInsights.push(result.incompleteProducts+' products lack complete sales observations or full-month statements for the selected period and are omitted.');
  const movementInsights=[movement.nonMovingCount?movement.nonMovingCount+' '+(movementScope==='agency'?'product / agency pairs':'products')+' '+(movementMode==='zero'?'recorded zero sales throughout':'sold at most '+exact(number(maxUnits))+' units across')+' '+period+', with '+exact(movement.stockUnits)+' units still held at '+monthLabel(f.end)+(movement.stockTotal==null?'. Closing stock value is unavailable.':', worth '+exact(movement.stockTotal,true)+' in closing stock.'):'No confirmed '+(movementMode==='zero'?'zero-sale':'low-sale')+' stock matches the selected period and thresholds.'];
  if(movement.nonMoving[0])movementInsights.push(movement.nonMoving[0].name+' · '+movement.nonMoving[0].agency+' has the most '+(stockValue?'stock value: '+exact(movement.nonMoving[0].value,true):'stock units: '+exact(movement.nonMoving[0].qoh))+'.');
  if(movement.unknownMovement)movementInsights.push(movement.unknownMovement+' '+(movementScope==='agency'?'product / agency pairs':'products')+' have incomplete sales coverage; they are not classified as zero-sale.');
  if(movement.unplottedMovement)movementInsights.push(movement.unplottedMovement+' matching entries have unknown '+(stockValue?'stock value':'stock units')+' and cannot be plotted.');
  return <section aria-label="Product sales and non-moving stock analysis" className="product-rankings">
    <div className="section-heading"><div><p className="eyebrow">PRODUCT RANKINGS</p><h2>{mode==='sales'?'Top-selling products':mode==='movement'?'Stock needing attention':'Product analysis'}</h2></div><span className="period-label">{mode==='sales'?salesPeriod:period} · {(mode==='sales'?topData.filters.agency:f.agency)||'All agencies'}</span></div>
    <div className="ranking-filters"><label>Find product, SKU or agency<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search this report"/></label><label>Show per chart<select value={limit} onChange={e=>setLimit(Number(e.target.value))}>{[5,10,20].map(n=><option key={n} value={n}>Top {n}</option>)}</select></label><button className="text-button" onClick={()=>{setSearch('');setLimit(10);setTopScope(null);setStockScope(null);setSalesMetric('estimatedValue');setMovementScope('agency');setMovementMode('zero');setMaxUnits('5');setMinStock('1');setMinAge('');setStockMetric('value');}}>Reset view</button></div>
    <p className="scope-note">Change the period or agency right inside the chart. Report filters apply until you choose a chart-specific selection.</p>
    <div className={mode==='both'?'chart-grid':'ranking-report-grid'}>
      {mode!=='movement'&&<ChartPanel title={valueSales?'Top-Selling Products by Estimated Sales Value':'Top-Selling Products by Units Sold'} subtitle={'Showing '+result.top.length+' of '+result.topCount+' · '+salesPeriod+(valueSales?' · estimated ₹':' · units')} type="bar" horizontal currency={valueSales} chartHeight={Math.max(320,result.top.length*34+85)} labels={result.top.map(row=>row.name)} datasets={[{label:valueSales?'Estimated sales value':'Units sold',data:result.top.map(row=>row[salesMetric])}]} onPoint={i=>onSelect(result.top[i].productKey,undefined,topData.filters)} interactionHint="Select a product to open its trends and agency breakdown." emptyText={valueSales?'No complete value estimates for these filters. Try Units sold.':'No products with positive, fully observed sales match these filters.'} takeaway={showInsights?topInsights:null} columns={[productColumn,{label:'SKU',key:'sku'},{label:'Observed agencies',key:'agency'},numeric('Units sold','units'),numeric('Estimated sales value ₹','estimatedValue',true)]} rows={result.top}>
        <ReportFilters visual custom={!!topScope} data={topData} onChange={patch=>scopeChange(topData.filters,patch,setTopScope)} onReset={()=>setTopScope(null)}/><div className="ranking-filters"><label>Rank by<select value={salesMetric} onChange={e=>setSalesMetric(e.target.value)}><option value="estimatedValue">Estimated sales value ₹</option><option value="units">Units sold</option></select></label></div>
      </ChartPanel>}
      {mode!=='sales'&&<ChartPanel title={movementMode==='zero'?'Zero-Sale / Non-Moving Products':'Low-Sale Products'} subtitle={'Showing '+movement.nonMoving.length+' of '+movement.nonMovingCount+' matches · stock at '+monthLabel(f.end)} type="bar" horizontal currency={stockValue} chartHeight={Math.max(320,movement.nonMoving.length*34+85)} labels={movement.nonMoving.map(row=>row.name+' · '+row.agency)} datasets={[{label:stockValue?'Closing stock value':'Closing stock units',color:'#e65722',data:movement.nonMoving.map(row=>row[stockMetric])}]} onPoint={i=>choose(movement.nonMoving[i])} interactionHint="Select an entry to inspect the product and its agency." emptyText="No confirmed non-moving stock matches these filters. Incomplete sales are excluded." takeaway={showInsights?movementInsights:null} columns={[{label:'Product',render:row=><button type="button" onClick={()=>choose(row)}>{row.name}</button>},{label:'Agency',key:'agency'},numeric('Period units sold','units'),numeric('Closing units','qoh'),numeric('Closing stock ₹','value',true),numeric('Min. recorded age','age')]} rows={movement.nonMoving}>
        <ReportFilters visual custom={!!stockScope} data={stockData} onChange={patch=>scopeChange(stockData.filters,patch,setStockScope)} onReset={()=>setStockScope(null)}/><div className="ranking-filters movement-filters"><label>Movement scope<select value={movementScope} onChange={e=>setMovementScope(e.target.value)}><option value="agency">By product + agency</option><option value="product">Across observed agencies</option></select></label><label>Sales condition<select value={movementMode} onChange={e=>setMovementMode(e.target.value)}><option value="zero">Zero sales in every observation</option><option value="slow">Period units sold ≤ threshold</option></select></label>{movementMode==='slow'&&<label>Units sold ≤<input type="number" min="0" step="any" value={maxUnits} onChange={e=>setMaxUnits(e.target.value)}/></label>}<label>Closing units ≥<input type="number" min="0" step="any" value={minStock} onChange={e=>setMinStock(e.target.value)}/></label><label>Recorded age ≥<input type="number" min="0" step="any" placeholder="Any" value={minAge} onChange={e=>setMinAge(e.target.value)}/></label><label>Rank stock by<select value={stockMetric} onChange={e=>setStockMetric(e.target.value)}><option value="value">Closing stock value ₹</option><option value="qoh">Closing stock units</option></select></label></div>
        <p className="scope-note">Bars show remaining stock, so zero-sale entries remain visible. Age uses the minimum recorded age across closing observations; its unit is as recorded in the source.</p>
      </ChartPanel>}
    </div>
  </section>;
}
