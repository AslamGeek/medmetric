'use client';
import {useEffect,useState} from 'react';
import {exact,monthLabel} from './ChartPanel.jsx';
import ProductRankings from './ProductRankings.jsx';
import LiquidityBadge,{coverDays} from './LiquidityBadge.jsx';
import {liquidityCategories} from '../lib/product-liquidity.js';
import {productExplorerModel,productStatuses} from '../lib/product-explorer.js';
import {productPrescribers} from '../lib/doctor-directory.js';
import ProductPrices,{ProductPriceList} from './ProductPrices.jsx';
import {pricesForSku} from '../lib/product-prices.js';

export default function ProductCatalog({data,fieldSnapshot,onRefreshDoctors,onSelect,rankingView='sales',onRankingViewChange,openProductsRequest=0}) {
  const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[liquidityCategory,setLiquidityCategory]=useState('all');
  const [visualSection,setVisualSection]=useState('products');
  useEffect(()=>{setVisualSection('products');},[openProductsRequest]);
  const f=data.filters;
  const model=productExplorerModel(data.productAnalysis,data.options.products,{search,status,liquidity:data.liquidity,liquidityCategory,agencies:f.agency?[f.agency]:data.options.agencies});
  const prescribers=productPrescribers(fieldSnapshot?.data);
  const selectedStatus=productStatuses.find(item=>item.key===status)?.label;
  const baseline=data.liquidity.months.map(monthLabel).join(' → ');
  const keys=new Set(model.visible.map(product=>product.key));
  const analysis={products:data.productAnalysis.products.filter(product=>keys.has(product.key)),agencies:data.productAnalysis.agencies.filter(row=>keys.has(row.productKey))};
  return <section className="product-explorer" aria-label="Product explorer visuals">
    <nav className="product-report-tabs" aria-label="Explorer views">{[['products','Products'],['prices','Price list']].map(([key,label])=><button type="button" key={key} aria-pressed={visualSection===key} onClick={()=>setVisualSection(key)}>{label}</button>)}</nav>
    <div hidden={visualSection!=='prices'}><ProductPriceList data={data} onSelect={onSelect}/></div>
    <div hidden={visualSection!=='products'}>
      <div className="explorer-toolbar"><label>Find a product<input type="search" placeholder="Search name, SKU or brand" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Movement status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All products</option>{productStatuses.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label><button className="text-button" onClick={()=>{setSearch('');setStatus('all');setLiquidityCategory('all');}}>Reset explorer</button></div>
      <div className="explorer-cover-filters"><div><strong>Stock cover</strong><span>{baseline} sales pace · stock at {monthLabel(f.end)}</span></div><div className="explorer-cover-chips" role="group" aria-label="Filter by stock cover"><button type="button" aria-pressed={liquidityCategory==='all'} onClick={()=>setLiquidityCategory('all')}>All <b>{model.liquidityMix.reduce((total,row)=>total+row.count,0)}</b></button>{model.liquidityMix.filter(row=>row.count>0||row.key===liquidityCategory).map(row=><button type="button" key={row.key} aria-pressed={liquidityCategory===row.key} title={row.range} onClick={()=>setLiquidityCategory(liquidityCategory===row.key?'all':row.key)}><i style={{background:row.color}} aria-hidden="true"/>{row.label} <b>{row.count}</b></button>)}</div></div>
      <ProductRankings data={data} analysis={analysis} mode={rankingView} onModeChange={onRankingViewChange} onSelect={onSelect}/>
    <section className="panel product-catalog" aria-label="Explore products">
      <div className="catalog-heading"><div><h2>{liquidityCategories.find(c=>c.key===liquidityCategory)?.label||selectedStatus||'Choose a product'}</h2><p>Open monthly sales, stock and prices.</p></div><span className="count">{model.visible.length} products</span></div>
      {fieldSnapshot?.error&&<p className="message error" role="alert">{fieldSnapshot.data?'Could not refresh prescribing doctors. Saved names are still shown.':'Prescribing doctors are unavailable.'} <button type="button" className="text-button" disabled={fieldSnapshot.loading} onClick={onRefreshDoctors}>Retry loading doctors</button></p>}
      <div className="product-list">{model.visible.map(p=><article className="product-card" key={p.key}><button type="button" className="product-card-open" aria-label={'Open product analysis for '+p.name} onClick={()=>onSelect(p.key)}>
        <span><strong>{p.name}</strong><small>{[p.brand,p.sku].filter(Boolean).join(' · ')}</small>
          <span className="catalog-liquidity"><LiquidityBadge value={p.liquidity}/><span>{coverDays(p.liquidity.daysOfCover)}</span></span>
          <span className="catalog-metrics"><span>Sold <b>{exact(p.units)}</b></span><span>Stock <b>{exact(p.qoh)}</b></span></span>
        </span><span aria-hidden="true">↗</span>
      </button><div className="product-prescribers"><h3>Prescribing doctors <span>{fieldSnapshot?.data?(prescribers.get(p.sku)||[]).length:'—'}</span></h3>{fieldSnapshot?.data?((prescribers.get(p.sku)||[]).length?<ul>{prescribers.get(p.sku).map(doctor=><li key={doctor.Doctor_ID} title={[doctor.Doctor_ID,doctor.Camp,doctor.Area].filter(Boolean).join(' · ')}>{doctor.Doctor_Name}</li>)}</ul>:<p>No prescribing doctors linked.</p>):<p role="status">{fieldSnapshot?.error?'Doctor data unavailable.':'Loading prescribing doctors…'}</p>}</div><ProductPrices compact productName={p.name} prices={pricesForSku(data.prices,p.sku)} status={data.priceStatus}/></article>)}</div>{!model.visible.length&&<p className="empty-text">No products match this search and category selection.</p>}
    </section>
    </div>
  </section>;
}
