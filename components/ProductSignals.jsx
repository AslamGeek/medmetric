'use client';
import ChartPanel,{exact,monthLabel,percentage} from './ChartPanel.jsx';
import {actionCategories,momentumCategories,stockValueByCategory} from '../lib/product-signals.js';
import {coverDays} from './LiquidityBadge.jsx';

export function SignalBadge({value,kind='momentum'}) {
  const item=(kind==='action'?actionCategories:momentumCategories).find(row=>row.key===value)||momentumCategories.at(-1);
  return <span className="signal-badge" style={{color:item.color,borderColor:item.color+'55',backgroundColor:item.color+'0d'}}>{item.label}</span>;
}
function CategoryCards({title,description,items,selected,onChange}) {
  return <section className="panel signal-categories" aria-label={title}>
    <div className="signal-heading"><div><h2>{title}</h2><p>{description}</p></div><button className="text-button" disabled={selected==='all'} onClick={()=>onChange('all')}>Show all</button></div>
    <div className="signal-category-grid">{items.map(item=><button type="button" key={item.key} aria-pressed={selected===item.key} className={selected===item.key?'selected':''} onClick={()=>onChange(selected===item.key?'all':item.key)} style={{'--signal-color':item.color}} title={item.rule}>
      <span><i aria-hidden="true"/>{item.label}</span><strong>{exact(item.count)}</strong><small>products</small>
    </button>)}</div>
  </section>;
}
export default function ProductSignals({data,model,momentumCategory,actionCategory,onMomentum,onAction,onSelect,onValueScope,showInsights}) {
  if(!data.signals)return null;
  const signals=data.signals,recent=signals.recentMonths.map(monthLabel).join(' → '),previous=signals.previousMonths.map(monthLabel).join(' → ');
  const visible=model.visible.map(product=>({...product.signal,key:product.key,name:product.name,cover:product.liquidity}));
  const plotted=visible.filter(product=>Number.isFinite(product.cover.daysOfCover)&&Number.isFinite(product.growth));
  const scatter=actionCategories.map(item=>({label:item.label,color:item.color,data:plotted.filter(row=>row.action===item.key).map(row=>({x:row.cover.daysOfCover,y:row.growth,key:row.key,name:row.name}))})).filter(series=>series.data.length);
  const matrixRows=[...visible].sort((a,b)=>actionCategories.findIndex(row=>row.key===a.action)-actionCategories.findIndex(row=>row.key===b.action)||(b.value??-1)-(a.value??-1)||a.name.localeCompare(b.name));
  const values=stockValueByCategory(signals,visible.map(row=>row.key));
  const agencyNames=signals.agencyNames;
  const valueSeries=agencyNames.map(agency=>({label:agency,data:values.rows.map(row=>row.agencyValues[agency])}));
  const unplotted=visible.length-plotted.length;
  const counts=key=>visible.filter(row=>row.action===key).length;
  const slowValueRows=values.rows.filter(row=>['slow','verySlow','nonMoving'].includes(row.key));
  const slowValue=slowValueRows.every(row=>row.total!=null)?slowValueRows.reduce((total,row)=>total+row.total,0):null;
  const valueNote=values.incompleteAgencies.length?'Incomplete closing valuations: '+values.incompleteAgencies.join(', ')+'. Their entire agency stack is unavailable, so it cannot look like a complete total.':'All matching tracked product/agency pairs have full-month closing valuations.';
  return <div className="product-signals">
    <CategoryCards title="Sales momentum" description={'Daily sales pace · '+recent+' vs '+previous+' · stable within ±10%'} items={model.momentumMix} selected={momentumCategory} onChange={onMomentum}/>
    <CategoryCards title="Product review priorities" description="Combine stock cover and sales direction. Select a group to filter the charts and catalogue." items={model.actionMix} selected={actionCategory} onChange={onAction}/>
    <div className="chart-grid signal-chart-grid">
      <ChartPanel title="Product action matrix" subtitle={'Closing stock: '+monthLabel(data.filters.end)+' · growth in average daily unit sales'} type="scatter" labels={[]} datasets={scatter.length?scatter:[{label:'Products',data:[]}]} chartHeight={360} xAxisTitle="Stock cover · days" yAxisTitle="Daily sales pace change · %" referenceLines={{x:[30,90],y:[-10,0,10]}}
        onPoint={(index,series)=>{const point=scatter[series]?.data[index];if(point)onSelect(point.key);}} interactionHint="Select a product dot to open its analysis. Dashed lines mark 30/90 days of cover and the ±10% stable band."
        emptyText="No products have both comparable percentage growth and finite stock cover. Their review signals remain in the table and category cards."
        columns={[{label:'Product',render:row=><button onClick={()=>onSelect(row.key)}>{row.name}</button>},{label:'Momentum',render:row=><SignalBadge value={row.momentum}/>},{label:'Previous 3-month units',numeric:true,render:row=>exact(row.previous?.units)},{label:'Recent 3-month units',numeric:true,render:row=>exact(row.recent?.units)},{label:'Daily pace change',numeric:true,render:row=>percentage(row.growth)},{label:'Stock cover',numeric:true,render:row=>coverDays(row.cover.daysOfCover)},{label:'Review',render:row=><SignalBadge kind="action" value={row.action}/>},{label:'Closing stock value',numeric:true,render:row=>exact(row.value,true)},{label:'Data note',render:row=>[row.momentumReason||row.cover.reason||(!Number.isFinite(row.cover.daysOfCover)?'Non-moving stock has no finite cover.':'Comparable full-month sales and stock units.'),row.value==null?'Closing stock valuation is incomplete.':''].filter(Boolean).join(' ')}]} rows={matrixRows}
        takeaway={showInsights?[counts('replenish')+' products need replenishment review; '+counts('stockout')+' need stockout review; '+counts('excess')+' need excess-stock review.',plotted.length+' of '+visible.length+' matching products can be plotted'+(unplotted?'; '+unplotted+' stay in the table because growth or cover is unavailable.':'.')]:null}/>
      <ChartPanel title="Stock value by cover category" subtitle={'Closing inventory value · '+monthLabel(data.filters.end)+' · each agency classified separately'} horizontal type="bar" stacked currency chartHeight={360} labels={values.rows.map(row=>row.label)} datasets={valueSeries}
        onPoint={(index,series)=>{if(agencyNames[series])onValueScope(values.rows[index].key,agencyNames[series]);}} interactionHint="Select an agency segment to focus that agency and cover category. This is inventory value, not sales revenue."
        columns={[{label:'Cover category',key:'label'},{label:'Tracked product/agency pairs',numeric:true,key:'pairCount'},...agencyNames.map(agency=>({label:agency+' · ₹',numeric:true,render:row=>row.agencyValues[agency]==null?'—':<button onClick={()=>onValueScope(row.key,agency)}>{exact(row.agencyValues[agency],true)}</button>})),{label:'Combined value · ₹',numeric:true,render:row=>exact(row.total,true)}]} rows={values.rows}
        takeaway={showInsights?[slowValue==null?'Combined slow-stock value is unavailable because some closing valuations are incomplete.':exact(slowValue,true)+' is held in slow, very slow or non-moving agency stock.']:null}><p className="scope-note">{valueNote}</p></ChartPanel>
    </div>
    <p className="scope-note signal-method">Momentum compares two fixed three-calendar-month windows ending at To, using actual calendar days ({signals.recentDays} recent; {signals.previousDays} previous). Every historically tracked agency in the selected scope needs full statements and product observations. From still scopes period sales and movement status. Started/resumed sales and confirmed zero baselines have no invented growth percentage; non-moving stock has no infinite cover. Agency cover categories may differ from the combined product category. Review signals use the statement date and are prompts to investigate, not reorder quantities.</p>
  </div>;
}
