'use client';
import {useState} from 'react';

export default function ProductCatalog({products,onSelect}) {
  const [search,setSearch]=useState('');
  const matches=products.filter(p=>`${p.name} ${p.sku} ${p.brand}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="panel product-catalog" aria-label="Explore products"><div className="catalog-heading"><div><h2>Choose a product</h2><p>Open its sales, stock, agency comparisons and insights.</p></div><label className="catalog-search"><span className="sr-only">Search products</span><input type="search" placeholder="Search name, SKU or brand" value={search} onChange={e=>setSearch(e.target.value)}/></label></div><p className="catalog-count">{matches.length} products</p><div className="product-list">{matches.map(p=><button type="button" className="product-card" key={p.key} onClick={()=>onSelect(p.key)}><span><strong>{p.name}</strong><small>{[p.brand,p.sku].filter(Boolean).join(' · ')}</small></span><span aria-hidden="true">↗</span></button>)}</div>{!matches.length && <p className="empty-text">No products match your search.</p>}</section>;
}
