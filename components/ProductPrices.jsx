'use client';
import {useState} from 'react';
import {DataTable,monthLabel} from './ChartPanel.jsx';
import {currentPrices,schemeNetPrice} from '../lib/product-prices.js';
const amount=value=>value==null?'—':'₹'+Number(value).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const tax=value=>value==null?'—':(value*100).toLocaleString('en-IN',{maximumFractionDigits:2})+'%';
const percent=value=>value==null?'—':(value*100).toLocaleString('en-IN',{maximumFractionDigits:2})+'%';
const scheme=price=>price.paid!=null&&price.free!=null?`${price.paid}+${price.free}`:price.scheme||'—';
const priceFields=price=>[
  ['MRP',amount(price.mrp)],['PTS',amount(price.pts)],['PTR',amount(price.ptr)],['Tax',tax(price.tax)],['Scheme',scheme(price)],
  ['Net price · incl. GST',amount(price.net)],['Effective cost / pack · ex-GST',amount(price.effectiveCost)],
  ['Profit / received pack',amount(price.profitPerPack)],['Profit / sale value',percent(price.profitPct)],
  ['Return on pre-tax spend',percent(price.returnOnSpend)]
];
const lotFields=price=>[
  ['Purchase value · paid packs · ex-GST',amount(price.purchaseValue)],['Sale value · full lot · ex-GST',amount(price.saleValue)],
  ['Trade profit / lot · before income tax',amount(price.profitLot)]
];
const metricGrid=fields=><dl className="product-price-metrics">{fields.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>;
export function SchemeCalculator({price,expanded=false}){
  const listedPtr=typeof price.ptr==='number'&&Number.isFinite(price.ptr)&&price.ptr>=0;
  const [open,setOpen]=useState(expanded),[paid,setPaid]=useState(String(price.paid??10)),[free,setFree]=useState(String(price.free??0)),[manualPtr,setManualPtr]=useState('');
  const ptr=listedPtr?price.ptr:manualPtr,net=schemeNetPrice(ptr,paid,free);
  function reset(){setPaid(String(price.paid??10));setFree(String(price.free??0));setManualPtr('');}
  return <details className="scheme-calculator" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>Calculate offer <span>Scratchpad</span></summary>
    {open&&<div className="scheme-calculator-body" role="group" aria-label={'Offer calculator for '+(price.name||'this product')+(price.pack?' · '+price.pack:'')}>
      <div className="scheme-calculator-context">{price.pack&&<span>Pack · {price.pack}</span>}{listedPtr&&<span>Listed PTR · <b>{amount(price.ptr)}</b></span>}</div>
      {!listedPtr&&<label>PTR for this calculation<input type="number" min="0" step="0.01" inputMode="decimal" value={manualPtr} onChange={e=>setManualPtr(e.target.value)} placeholder="Enter PTR"/><small>No listed PTR is available. Enter a rate for this scratchpad.</small></label>}
      <div className="scheme-calculator-inputs"><label>Paid packs<input type="number" min="1" step="1" inputMode="numeric" value={paid} onChange={e=>setPaid(e.target.value)}/></label><label>Free packs<input type="number" min="0" step="1" inputMode="numeric" value={free} onChange={e=>setFree(e.target.value)}/></label></div>
      <div className="scheme-calculator-result" role="status" aria-live="polite" aria-atomic="true"><span>Proposed net price · incl. GST</span><strong>{amount(net)}</strong><small>{net!=null?amount(Number(ptr))+' × '+paid+' ÷ '+(Number(paid)+Number(free))+' · scheme '+paid+'+'+free:'Enter a valid PTR, positive whole paid packs and zero or more whole free packs.'}</small></div>
      <div className="scheme-calculator-footer"><small>Temporary calculation. Listed scheme and prices stay unchanged.</small><button type="button" onClick={reset}>Reset</button></div>
    </div>}
  </details>;
}
const calculatorKey=price=>JSON.stringify([price.key,price.ptr,price.paid,price.free]);
export default function ProductPrices({prices=[],status='loaded',compact=false,productName='this product'}){
  if(!prices.length)return <div className="catalog-prices"><span className="product-price-empty">{status==='loaded'?'No current price listed for this SKU.':'Price list has not loaded. Refresh data to try again.'}</span><SchemeCalculator key={productName} price={{name:productName,ptr:null}}/></div>;
  if(compact)return <div className="catalog-prices">{prices.map(price=><section className="catalog-price-pack" key={price.key}>
    <span className="price-pack-label">Listed pack · {price.pack||'—'} <span>From {monthLabel(price.effectiveFrom)}</span></span>
    {metricGrid(priceFields(price))}
    <details className="price-economics"><summary>Lot economics</summary>{metricGrid(lotFields(price))}</details>
    {price.issues.length>0&&<span className="price-issue">Some price data needs review.</span>}
    <SchemeCalculator key={calculatorKey(price)} price={price}/>
  </section>)}</div>;
  return <section className="panel product-price-detail" aria-label="Product prices"><h2>Prices &amp; scheme</h2>{prices.map(price=><article key={price.key}>
    <div className="price-detail-heading"><strong>{price.name} · {price.pack||'Pack not specified'}</strong><span>Effective from {monthLabel(price.effectiveFrom)}</span></div>
    <h3 className="price-subheading">Listed price and per-pack economics</h3>{metricGrid(priceFields(price))}
    <h3 className="price-subheading">Whole-lot estimate</h3>{metricGrid(lotFields(price))}
    <p>Net price applies the listed paid/free scheme to PTR. Effective cost removes GST. Lot profit assumes the full lot sells at listed MRP before GST; it excludes overhead, returns and discounts. Prices apply only to the listed pack.</p>
    {price.notes&&<p className="price-source-note">{price.notes}</p>}{price.issues.length>0&&<p className="price-issue">{price.issues.join(' ')}</p>}
    <SchemeCalculator key={calculatorKey(price)} price={price}/>
  </article>)}</section>;
}
export function ProductPriceList({data,onSelect}){
  const [search,setSearch]=useState('');
  const catalogue=new Map(data.options.products.filter(p=>p.sku).map(p=>[p.sku,p]));
  const prices=currentPrices(data.prices),query=search.trim().toLowerCase(),rows=prices.filter(p=>[p.name,p.sku,p.pack].some(v=>v.toLowerCase().includes(query)));
  const months=[...new Set(prices.map(p=>p.effectiveFrom))].sort();
  return <section className="panel product-price-list" aria-label="Manufacturer price list">
    <header className="price-list-heading"><div><h2>Manufacturer price list</h2><p>{prices.length} listed products / packs · {months.map(monthLabel).join(', ')||'No effective list loaded'} · current list prices across the catalogue</p></div><label>Find a listed product<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product, SKU or pack"/></label></header>
    <p className="scope-note">Net price applies the paid/free scheme to PTR. Effective cost and lot estimates exclude GST. The full price list includes products with no linked sales history; sales filters do not change these prices.</p>
    {data.priceWarnings?.length>0&&<p className="message error" role="status">{data.priceWarnings.join(' ')}</p>}
    <DataTable rows={rows} empty={data.priceStatus==='loaded'?'No prices match this search.':'The price list has not loaded. Refresh data to try again.'} columns={[
      {label:'Product',render:p=>catalogue.has(p.sku)?<button onClick={()=>onSelect(catalogue.get(p.sku).key)}>{p.name}</button>:p.name},
      {label:'Pack as listed',key:'pack'},
      {label:'MRP',numeric:true,render:p=>amount(p.mrp)},
      {label:'PTS',numeric:true,render:p=>amount(p.pts)},
      {label:'PTR',numeric:true,render:p=>amount(p.ptr)},
      {label:'Tax',numeric:true,render:p=>tax(p.tax)},
      {label:'Scheme',key:'scheme'},
      {label:'Net price · incl. GST',numeric:true,render:p=>amount(p.net)},
      {label:'Effective cost / pack · ex-GST',numeric:true,render:p=>amount(p.effectiveCost)},
      {label:'Purchase value · paid packs · ex-GST',numeric:true,render:p=>amount(p.purchaseValue)},
      {label:'Sale value · full lot · ex-GST',numeric:true,render:p=>amount(p.saleValue)},
      {label:'Trade profit / lot',numeric:true,render:p=>amount(p.profitLot)},
      {label:'Profit / received pack',numeric:true,render:p=>amount(p.profitPerPack)},
      {label:'Profit / sale value',numeric:true,render:p=>percent(p.profitPct)},
      {label:'Return on pre-tax spend',numeric:true,render:p=>percent(p.returnOnSpend)},
      {label:'Offer calculator',render:p=><SchemeCalculator key={calculatorKey(p)} price={p}/>},
      {label:'Effective from',render:p=>monthLabel(p.effectiveFrom)},
      {label:'Product SKU',render:p=>p.sku||'—'},
      {label:'Notes',render:p=>[p.notes,...p.issues,!catalogue.has(p.sku)?'Price list only; no product in the current sales selection.':''].filter(Boolean).join(' ')||'—'}
    ]}/>
  </section>;
}
