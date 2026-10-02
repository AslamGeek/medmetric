import test from 'node:test';
import assert from 'node:assert/strict';
import {productExplorerModel} from '../lib/product-explorer.js';

function fixture() {
  const products=[
    {key:'selling',name:'Selling',sku:'S',brand:'X',complete:true,units:30,qoh:20,zeroSales:false},
    {key:'idle',name:'Idle',sku:'I',brand:'Y',complete:true,units:0,qoh:50,zeroSales:true},
    {key:'empty',name:'Sold out',sku:'E',brand:'X',complete:true,units:10,qoh:0,zeroSales:false},
    {key:'partial',name:'Partial',sku:'P',brand:'Y',complete:false,units:null,qoh:30,zeroSales:false}
  ];
  const agencies=products.map(p=>({...p,productKey:p.key,agency:'A'}));
  const catalog=[...products,{key:'absent',name:'No observations',sku:'N',brand:'Y'}];
  return {analysis:{products,agencies},catalog};
}
const model=(options={})=>{const {analysis,catalog}=fixture();return productExplorerModel(analysis,catalog,{agencies:['A','B'],...options});};

test('movement mix includes every catalogue product and keeps absent/partial data unknown',()=>{
  const m=model();assert.deepEqual(m.categories.map(row=>row.count),[1,1,1,2]);
  assert.equal(m.categories.reduce((sum,row)=>sum+row.count,0),m.products.length);
  assert.equal(m.products.find(row=>row.key==='absent').units,null);
  assert.equal(m.products.find(row=>row.key==='partial').movement,'unknown');
});

test('movement selection filters the list and agency bars, while mix retains its search context',()=>{
  const m=model({status:'idle'});assert.equal(m.visible.length,1);assert.equal(m.visible[0].key,'idle');
  assert.equal(m.balance[0].units,0);assert.equal(m.balance[0].qoh,50);assert.equal(m.balance[0].included,1);
  assert.equal(m.categories.reduce((sum,row)=>sum+row.count,0),5);
});

test('agency comparisons use the same complete product set for sales and stock',()=>{
  const m=model();assert.equal(m.balance[0].units,40);assert.equal(m.balance[0].qoh,70);
  assert.equal(m.balance[0].included,3);assert.equal(m.balance[0].excluded,1);
  assert.equal(m.balance[1].units,null);assert.equal(m.balance[1].qoh,null);
  const unknown=model({status:'unknown'});assert.equal(unknown.balance[0].units,null);assert.equal(unknown.balance[0].qoh,null);
});

test('search by brand or SKU affects status counts, agency balance and visible catalogue',()=>{
  const x=model({search:'X'});assert.equal(x.visible.length,2);assert.equal(x.balance[0].units,40);assert.equal(x.unknown,0);
  const sku=model({search:'I',status:'idle'});assert.equal(sku.visible[0].key,'idle');
  assert.equal(model({search:'nothing'}).visible.length,0);
});

test('returns, negative stock, and missing stock do not become zero-sale or selling-with-stock claims',()=>{
  for(const change of [{units:0,negativeSales:true,zeroSales:true},{qoh:-1},{qoh:null}]) {
    const {analysis,catalog}=fixture();Object.assign(analysis.products[0],change);
    const m=productExplorerModel(analysis,catalog,{agencies:['A']});
    assert.equal(m.products[0].movement,'unknown');assert.equal(m.balance[0].included,2);
  }
});
