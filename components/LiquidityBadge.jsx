import {liquidityCategories,formatCoverDays} from '../lib/product-liquidity.js';

export const coverDays=formatCoverDays;
export default function LiquidityBadge({value}) {
  const category=liquidityCategories.find(c=>c.key===value?.category)||liquidityCategories.at(-1);
  return <span className="liquidity-badge" style={{color:category.color,borderColor:category.color+'55'}} title={value?.reason||category.range}>{category.label}</span>;
}
