'use client';
import {useState} from 'react';
import ChartPanel,{exact,monthLabel} from './ChartPanel.jsx';
import LiquidityBadge,{coverDays} from './LiquidityBadge.jsx';
import {liquidityCategories} from '../lib/product-liquidity.js';
import {productExplorerModel,productStatuses} from '../lib/product-explorer.js';
import {productPrescribers} from '../lib/doctor-directory.js';
import ProductPrices,{ProductPriceList} from './ProductPrices.jsx';
import {pricesForSku} from '../lib/product-prices.js';

export default function ProductCatalog({data,fieldSnapshot,onRefreshDoctors,onSelect,onAgency,showInsights=true}) {
  const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[liquidityCategory,setLiquidityCategory]=useState('all');
  const [visualSection,setVisualSection]=useState('cover');
  const f=data.filters,period=f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end);
  const model=productExplorerModel(data.productAnalysis,data.options.products,{search,status,liquidity:data.liquidity,liquidityCategory,agencies:f.agency?[f.agency]:data.options.agencies});
  const prescribers=productPrescribers(fieldSnapshot?.data);
  const selectedStatus=productStatuses.find(item=>item.key===status)?.label;
  const baseline=data.liquidity.months.map(monthLabel).join(' → ');
  const slowCount=model.liquidityMix.filter(row=>['slow','verySlow','nonMoving'].includes(row.key)).reduce((total,row)=>total+row.count,0);
  return <section className="product-explorer" aria-label="Product explorer visuals">
    <div className="explorer-toolbar"><label>Find a product<input type="search" placeholder="Search name, SKU or brand" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Stock cover category<select value={liquidityCategory} onChange={e=>setLiquidityCategory(e.target.value)}><option value="all">All categories</option>{liquidityCategories.map(item=><option key={item.key} value={item.key}>{item.label} · {item.range}</option>)}</select></label><label>Movement status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All products</option>{productStatuses.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label><button className="text-button" onClick={()=>{setSearch('');setStatus('all');setLiquidityCategory('all');}}>Reset explorer</button></div>
    <nav className="product-report-tabs" aria-label="Explorer analysis views">{[['cover','Stock cover'],['prices','Price list']].map(([key,label])=><button type="button" key={key} aria-pressed={visualSection===key} onClick={()=>setVisualSection(key)}>{label}</button>)}</nav>
    <div hidden={visualSection!=='prices'}><ProductPriceList data={data} onSelect={onSelect}/></div>
    <div className="chart-grid explorer-visuals" hidden={visualSection!=='cover'}>
      <ChartPanel title="Product stock cover categories" subtitle={'Closing stock: '+monthLabel(f.end)+' · sales baseline: '+baseline+' ('+data.liquidity.days+' days)'} horizontal type="bar" unit="Products" chartHeight={330} labels={model.liquidityMix.map(row=>row.label)} datasets={[{label:'Products',data:model.liquidityMix.map(row=>row.count),color:model.liquidityMix.map(row=>row.color)}]} onPoint={index=>setLiquidityCategory(model.liquidityMix[index].key)} interactionHint="Select a category to filter the catalogue and agency chart. These categories estimate liquidation pace, not actual stock age." columns={[{label:'Category',render:row=><button onClick={()=>setLiquidityCategory(row.key)}>{row.label}</button>},{label:'Rule',key:'range'},{label:'Products',numeric:true,key:'count'}]} rows={model.liquidityMix} takeaway={showInsights?[model.liquidityMix.find(row=>row.key==='fast').count+' products have less than 30 days of cover; '+slowCount+' are slow, very slow or non-moving.',model.liquidityMix.find(row=>row.key==='unknown').count+' have insufficient data. Missing months and negative adjustments are not treated as zero sales.']:null}/>
      <ChartPanel title="Agency sales & remaining stock" subtitle={'Sales: '+period+' · stock: '+monthLabel(f.end)+(selectedStatus?' · '+selectedStatus:'')} horizontal type="bar" unit="Units" chartHeight={250} labels={model.balance.map(row=>row.agency)} datasets={[{label:'Units sold in period',data:model.balance.map(row=>row.units),color:'#3489e0'},{label:'Closing stock units',data:model.balance.map(row=>row.qoh),color:'#e65722'}]} onPoint={index=>onAgency(model.balance[index].agency)} interactionHint="Select an agency to focus the explorer. Sales are a period flow; stock is the end-month snapshot." columns={[{label:'Agency',render:row=><button onClick={()=>onAgency(row.agency)}>{row.agency}</button>},{label:'Period units sold',numeric:true,render:row=>exact(row.units)},{label:'Closing units',numeric:true,render:row=>exact(row.qoh)},{label:'Included product/agency pairs',numeric:true,key:'included'},{label:'Excluded observed pairs',numeric:true,key:'excluded'}]} rows={model.balance} takeaway={showInsights?model.balance.map(row=>row.included?row.agency+': '+exact(row.units)+' period sale units and '+exact(row.qoh)+' closing units across '+row.included+' comparable product/agency pairs'+(row.excluded?'; '+row.excluded+' observed pairs excluded.':'.'):row.agency+': no comparable product/agency observations for this selection.'):null}/>
    </div>
    <p className="scope-note" hidden={visualSection!=='cover'}>Stock cover = closing units ÷ average daily sales over the three calendar months ending at the selected To month. From month still controls period sales, movement status and agency bars. Stock age remains a separate source observation. Agency bars use only products with complete sales and closing observations; unavailable values stay —. All visuals follow the persistent report filters.</p>
    <section className="panel product-catalog" aria-label="Explore products">
      <div className="catalog-heading"><div><h2>{liquidityCategories.find(c=>c.key===liquidityCategory)?.label||selectedStatus||'Choose a product'}</h2><p>Open its sales trend, stock trend and agency comparisons.</p></div><span className="count">{model.visible.length} products</span></div>
      {fieldSnapshot?.error&&<p className="message error" role="alert">{fieldSnapshot.data?'Could not refresh prescribing doctors. Saved names are still shown.':'Prescribing doctors are unavailable.'} <button type="button" className="text-button" disabled={fieldSnapshot.loading} onClick={onRefreshDoctors}>Retry loading doctors</button></p>}
      <div className="product-list">{model.visible.map(p=><article className="product-card" key={p.key}><button type="button" className="product-card-open" aria-label={'Open product analysis for '+p.name} onClick={()=>onSelect(p.key)}>
        <span><strong>{p.name}</strong><small>{[p.brand,p.sku].filter(Boolean).join(' · ')}</small>
          <span className="catalog-liquidity"><LiquidityBadge value={p.liquidity}/><span>{coverDays(p.liquidity.daysOfCover)}</span></span>
          <span className="catalog-metrics"><span>Sold <b>{exact(p.units)}</b></span><span>Stock <b>{exact(p.qoh)}</b></span></span>
        </span><span aria-hidden="true">↗</span>
      </button><div className="product-prescribers"><h3>Prescribing doctors <span>{fieldSnapshot?.data?(prescribers.get(p.sku)||[]).length:'—'}</span></h3>{fieldSnapshot?.data?((prescribers.get(p.sku)||[]).length?<ul>{prescribers.get(p.sku).map(doctor=><li key={doctor.Doctor_ID} title={[doctor.Doctor_ID,doctor.Camp,doctor.Area].filter(Boolean).join(' · ')}>{doctor.Doctor_Name}</li>)}</ul>:<p>No prescribing doctors linked.</p>):<p role="status">{fieldSnapshot?.error?'Doctor data unavailable.':'Loading prescribing doctors…'}</p>}</div><ProductPrices compact productName={p.name} prices={pricesForSku(data.prices,p.sku)} status={data.priceStatus}/></article>)}</div>{!model.visible.length&&<p className="empty-text">No products match this search and category selection.</p>}
    </section>
  </section>;
}
