export const DOCTOR_FILTERS=[['Camp','Camp'],['Area','Area'],['Specialties','Specialty'],['Prescriber_Status','Prescriber'],['Potential','Potential'],['Hospital','Hospital'],['Pharmacy_ID','Pharmacy'],['Product_SKU','Linked product'],['Call_Schedule','Call schedule'],['Stockist','Stockist'],['Active','Active']];
export const emptyDoctorFilters=()=>Object.fromEntries(DOCTOR_FILTERS.map(([key])=>[key,[]]));
export function productPrescribers(data){
  const doctors=new Map((data?.DOCTORS||[]).filter(doctor=>doctor.Active==='YES').map(doctor=>[doctor.Doctor_ID,doctor]));
  const products=new Map();
  for(const link of data?.DOCTOR_PRODUCTS||[]){
    const doctor=doctors.get(link.Doctor_ID);
    if(!doctor||!link.Product_SKU||link.Active!=='YES'||link.Relationship!=='EXISTING')continue;
    if(!products.has(link.Product_SKU))products.set(link.Product_SKU,new Map());
    products.get(link.Product_SKU).set(doctor.Doctor_ID,doctor);
  }
  return new Map([...products].map(([sku,linked])=>[sku,[...linked.values()].sort((a,b)=>a.Doctor_Name.localeCompare(b.Doctor_Name,undefined,{sensitivity:'base'})||a.Doctor_ID.localeCompare(b.Doctor_ID))]));
}
const normalize=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
const keyFor=(field,value)=>['Product_SKU','Pharmacy_ID'].includes(field)?String(value):normalize(value);
export const doctorSpecialties=value=>[...new Set(String(value||'').split(/[;,|]/).map(s=>s.trim()).filter(Boolean))];
export function doctorDirectory(data,{search='',filters={},sort='name'}={}){
  const pharmacies=new Map(data.PHARMACIES.map(p=>[p.Pharmacy_ID,p.Pharmacy_Name]));
  const products=new Map(data.products.map(p=>[p.Product_SKU,p.Product_Name]));
  const links=new Map();
  for(const link of data.DOCTOR_PRODUCTS){if(link.Active!=='YES'||!products.has(link.Product_SKU))continue;if(!links.has(link.Doctor_ID))links.set(link.Doctor_ID,new Set());links.get(link.Doctor_ID).add(link.Product_SKU);}
  const rows=data.DOCTORS.map(doctor=>{
    const skus=[...(links.get(doctor.Doctor_ID)||[])];
    const values=Object.fromEntries(DOCTOR_FILTERS.map(([field])=>[field,field==='Product_SKU'?skus:field==='Specialties'?doctorSpecialties(doctor.Specialties):[String(doctor[field]||'').trim()].filter(Boolean)]));
    const text=normalize([doctor.Doctor_ID,doctor.Doctor_Name,doctor.Specialties,doctor.Hospital,doctor.Area,doctor.Camp,doctor.Stockist,doctor.Prescriber_Status,doctor.Call_Schedule,pharmacies.get(doctor.Pharmacy_ID),...skus,...skus.map(sku=>products.get(sku))].join(' '));
    return {doctor,values,text,productNames:skus.map(sku=>products.get(sku))};
  });
  const terms=normalize(search).split(' ').filter(Boolean);
  const searched=rows.filter(row=>terms.every(term=>row.text.includes(term)));
  const matches=(row,except)=>DOCTOR_FILTERS.every(([field])=>field===except||!Array.isArray(filters[field])||!filters[field].length||row.values[field].some(value=>filters[field].some(selected=>keyFor(field,selected)===keyFor(field,value))));
  const matching=searched.filter(row=>matches(row));
  matching.sort((a,b)=>{
    const priority=sort==='potential'?(a.doctor.Potential||'Z').localeCompare(b.doctor.Potential||'Z'):sort==='prescriber'?Number(b.doctor.Prescriber_Status==='Rx')-Number(a.doctor.Prescriber_Status==='Rx'):0;
    return priority||String(a.doctor.Doctor_Name).localeCompare(String(b.doctor.Doctor_Name),undefined,{sensitivity:'base'})||a.doctor.Doctor_ID.localeCompare(b.doctor.Doctor_ID);
  });
  const groups=DOCTOR_FILTERS.map(([field,label])=>{
    const options=new Map(),counts=new Map();
    for(const row of rows)for(const value of row.values[field])options.set(keyFor(field,value),value);
    for(const value of filters[field]||[])options.set(keyFor(field,value),value);
    for(const row of searched.filter(row=>matches(row,field)))for(const key of new Set(row.values[field].map(value=>keyFor(field,value))))counts.set(key,(counts.get(key)||0)+1);
    return {field,label,items:[...options].map(([key,value])=>({value,label:field==='Product_SKU'?products.get(value)||value:field==='Pharmacy_ID'?pharmacies.get(value)||value:value,count:counts.get(key)||0})).sort((a,b)=>a.label.localeCompare(b.label))};
  });
  const doctors=matching.map(row=>row.doctor);
  return {doctors,groups,productNames:new Map(rows.map(row=>[row.doctor.Doctor_ID,row.productNames])),metrics:{total:doctors.length,rx:doctors.filter(d=>d.Prescriber_Status==='Rx').length,nrx:doctors.filter(d=>d.Prescriber_Status==='NRx').length,hospitals:new Set(doctors.map(d=>normalize(d.Hospital)).filter(Boolean)).size,pharmacies:new Set(doctors.map(d=>d.Pharmacy_ID).filter(Boolean)).size}};
}
