'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {createVisitSession,createVisitStore} from '../lib/visit-session.js';
import {visitToday,visitDay,visitAddDays,visitDateLabel,visitUnique,visitPicker,visitLastDates,visitRecency,visitHistory,visitDisplayLine,visitMonthGrid} from '../lib/visits.js';

async function request(body){
  const response=await fetch('/api/visits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(60000)});
  let result;try{result=await response.json();}catch{throw new Error('The visit connection returned an invalid response. Your local bundle is retained.');}
  if(!response.ok){const error=new Error(result.error||'Could not sync visits.');error.permanent=result.permanent===true;throw error;}return result;
}
function History({visits,camps}){
  const [date,setDate]=useState(''),[camp,setCamp]=useState(''),[expanded,setExpanded]=useState('');
  const [month,setMonth]=useState(visitToday().slice(0,7));
  const visible=visitHistory(visits,{date,camp}),groups=new Map();
  visible.forEach(visit=>{const key=visit.date.slice(0,7);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(visit);});
  const calendarVisits=visitHistory(visits,{camp}).filter(v=>v.date.startsWith(month));
  const days=visitMonthGrid(month);
  return <section className="visit-history">
    <div className="visit-heading"><h2>Visit history</h2><span>{visible.length} bundles</span></div>
    <div className="visit-controls"><label>History date<input type="date" value={date} onChange={e=>{setDate(e.target.value);setExpanded('');}}/></label><label>History camp<select value={camp} onChange={e=>{setCamp(e.target.value);setExpanded('');}}><option value="">All camps</option>{visitUnique([...camps,...visits.map(v=>v.camp)]).sort().map(c=><option key={c}>{c}</option>)}</select></label><button className="button" onClick={()=>{setDate('');setCamp('');}}>Clear history filters</button></div>
    <section className="visit-calendar panel" aria-label="Monthly visit calendar"><div className="visit-heading"><h3>Monthly calendar</h3><label>Calendar month<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label></div><div className="visit-calendar-grid">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=><strong key={day}>{day}</strong>)}{days.map((day,i)=>{
      const entries=calendarVisits.filter(v=>v.date===day),count=entries.reduce((sum,v)=>sum+v.doctorCount,0);
      return day?<button key={day} className={date===day?'selected':''} aria-label={visitDateLabel(day)+': '+entries.length+' bundles, '+count+' doctor calls'} onClick={()=>{setDate(day);setExpanded('');}}><span>{Number(day.slice(-2))}</span>{entries.length>0&&<small>{count?count+' calls':entries[0].kind}</small>}</button>:<span key={'blank-'+i}/>;
    })}</div><p className="scope-note">Select a day to filter history. Counts include saved and pending bundles.</p></section>
    {[...groups].map(([key,bundles],i)=><details className="visit-month panel" key={key} open={i===0||!!date}><summary>{new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(key+'-01T12:00:00Z'))}<span>{bundles.length} bundles</span></summary><div className="visit-history-list">{bundles.map(v=><article className={'visit-history-card '+(v.kind!=='Visit'?'no-visit':'')} key={v.localId}><button className="visit-history-summary" aria-expanded={expanded===v.localId} onClick={()=>setExpanded(expanded===v.localId?'':v.localId)}><span className="visit-history-date"><strong>{Number(v.date.slice(-2))}</strong>{v.day.slice(0,3)}</span><span><strong>{v.camp}</strong><small>{v.kind==='Visit'?`${v.doctorCount} doctors · ${v.pharmacyCount} pharmacies`:v.kind+' · No visits'}</small></span><span className={'visit-sync '+v.syncState}>{v.syncState==='synced'?'Saved to Sheets':'Pending sync'}</span><span>{expanded===v.localId?'−':'+'}</span></button>{expanded===v.localId&&<div className="visit-preview-columns">{v.kind==='Visit'?<><div><h4>Doctors</h4><ol>{v.doctorLines.map((line,i)=><li key={i}>{visitDisplayLine(line)}</li>)}</ol></div><div><h4>Pharmacies</h4>{v.pharmacyLines.length?<ol>{v.pharmacyLines.map((line,i)=><li key={i}>{visitDisplayLine(line)}</li>)}</ol>:<p>None linked</p>}</div></>:<p>This date was saved as a {v.kind.toLowerCase()} with no visits.</p>}</div>}</article>)}</div></details>)}
    {!visible.length&&<p className="panel">{date||camp?'No bundles match this date and camp.':'No visits yet. Saved bundles will appear here.'}</p>}
  </section>;
}
export default function Visits({visible,loadRequested=false,refreshVersion=0,focusDoctor,onLoadingChange,onSnapshotChange}){
  const [session]=useState(()=>createVisitSession({store:createVisitStore(typeof indexedDB==='undefined'?null:indexedDB),request,online:()=>typeof navigator==='undefined'||navigator.onLine,lock:work=>typeof navigator!=='undefined'&&navigator.locks?navigator.locks.request('medmetric-visits-sync',work):work()}));
  const [snapshot,setSnapshot]=useState(()=>session.snapshot()),[section,setSection]=useState('log');
  const [today,setToday]=useState(visitToday),[date,setDate]=useState(visitToday),[camp,setCamp]=useState(''),[noVisits,setNoVisits]=useState(false),[reason,setReason]=useState('Holiday');
  const [selected,setSelected]=useState([]),[query,setQuery]=useState(''),[specialty,setSpecialty]=useState(''),[schedule,setSchedule]=useState('Everyday');
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[undo,setUndo]=useState(null);
  const started=useRef(false),channel=useRef(null),focused=useRef(null);
  useEffect(()=>session.subscribe(()=>setSnapshot(session.snapshot())),[session]);
  useEffect(()=>{if(!visible&&!loadRequested)return;if(!started.current){started.current=true;void session.start();}else{void session.refresh();}},[visible,loadRequested,refreshVersion,session]);
  useEffect(()=>{
    session.resume();
    const resume=()=>{if(started.current&&document.visibilityState==='visible')void session.refresh();setToday(visitToday());};
    const midnight=setInterval(()=>setToday(visitToday()),60000);
    window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
    if(typeof BroadcastChannel!=='undefined'){channel.current=new BroadcastChannel('medmetric-visits');channel.current.onmessage=()=>{if(started.current)void session.refresh();};}
    return()=>{clearInterval(midnight);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);channel.current?.close();session.stop();};
  },[session]);
  useEffect(()=>{onLoadingChange?.(snapshot.loading);onSnapshotChange?.(snapshot);},[snapshot,onLoadingChange,onSnapshotChange]);
  useEffect(()=>{if(!undo)return;const timer=setTimeout(()=>setUndo(null),Math.max(0,undo.until-Date.now()));return()=>clearTimeout(timer);},[undo]);
  const doctors=snapshot.master?.doctors||[],camps=snapshot.master?.camps||[];
  useEffect(()=>{if(!camp&&camps.length)setCamp(camps[0]);},[camp,camps]);
  useEffect(()=>{
    if(!focusDoctor||!snapshot.master||focused.current===focusDoctor.request)return;
    const doctor=doctors.find(d=>d.id===focusDoctor.id);if(!doctor){setError('This doctor is no longer active. Refresh the doctor list.');return;}
    focused.current=focusDoctor.request;setSection('log');setCamp(doctor.camp);setDate(visitToday());setNoVisits(false);setSelected([doctor.id]);setSchedule(doctor.callSchedule||'');setSpecialty('');setQuery('');setError('');
  },[focusDoctor,doctors,snapshot.master]);
  const kind=visitDay(date)==='Sunday'?'Sunday':noVisits?reason:'Visit';
  const validIds=new Set(doctors.filter(d=>d.camp===camp).map(d=>d.id)),selectedDoctors=selected.map(id=>doctors.find(d=>d.id===id&&d.camp===camp)).filter(Boolean);
  const pharmacies=visitUnique(selectedDoctors.map(d=>d.pharmacy));
  const last=useMemo(()=>visitLastDates(snapshot.visits,date),[snapshot.visits,date]);
  const filtered=visitPicker(doctors,snapshot.visits,{camp,date,query,specialty,callSchedule:schedule});
  const specialties=visitUnique(doctors.filter(d=>d.camp===camp).flatMap(d=>d.specialties)).sort();
  const schedules=visitUnique(['Everyday',...(snapshot.master?.callSchedules||[]),...doctors.filter(d=>d.camp===camp).map(d=>d.callSchedule)]);
  async function save(){
    setError('');setSaving(true);
    try{
      if(selected.some(id=>!validIds.has(id)))throw new Error('A selected doctor changed or was removed. Clear the selection and review the current list.');
      const visit=await session.save({date,camp,kind,doctorIds:kind==='Visit'?selected:[]});
      setUndo({visit,until:Date.now()+8000});setNotice(kind==='Visit'?'Visit bundle saved on this device.':'No-visits day saved on this device.');setSelected([]);setDate(visitAddDays(date,1));setNoVisits(false);channel.current?.postMessage('change');
    }catch(e){setError(e.message);}finally{setSaving(false);}
  }
  async function undoSave(){if(!undo||Date.now()>undo.until)return;try{await session.undo(undo.visit);setUndo(null);setNotice('Visit bundle removed.');channel.current?.postMessage('change');}catch(e){setError(e.message);}}
  return <section className="visits-workspace" hidden={!visible} aria-label="Visits workspace">
    <div className="report-title"><div><p className="eyebrow">Field activity</p><h1>Visits</h1><p className="subtitle">Build daily call bundles and review your visit history.</p></div></div>
    <div className="visit-toolbar"><div className="visit-tabs" role="group" aria-label="Visits sections"><button aria-pressed={section==='log'} onClick={()=>setSection('log')}>Log visits</button><button aria-pressed={section==='history'} onClick={()=>setSection('history')}>Visit history</button></div><p role="status">{snapshot.syncing?'Saving to Sheets…':snapshot.loading?'Refreshing visits…':snapshot.queue.length?`${snapshot.queue.length} pending ${snapshot.queue.length===1?'operation':'operations'}`:'Saved to Sheets'}</p></div>
    {(error||snapshot.error)&&<div className="message error" role="alert"><p>{error||snapshot.error}</p>{snapshot.queue.length>0&&<><p>Local bundles are retained. Connection failures retry while the app is open. Review rejected bundles before retrying.</p><button className="button" onClick={()=>void session.retry()}>Refresh and retry sync</button>{snapshot.queue.filter(q=>q.action==='save'&&q.validation).map(q=><button className="button" key={q.opId} onClick={async()=>{try{await session.undo(q.visit);channel.current?.postMessage('change');}catch(e){setError(e.message);}}}>Discard rejected bundle · {visitDateLabel(q.visit.date)} · {q.visit.camp}</button>)}</>}{error&&<button className="text-button" onClick={()=>setError('')}>Dismiss</button>}</div>}
    {notice&&<div className="message visit-notice" role="status"><span>{notice}</span>{undo&&<button className="button" onClick={undoSave}>Undo</button>}<button className="text-button" onClick={()=>setNotice('')}>Dismiss</button></div>}
    {!snapshot.master?<p className="panel">{snapshot.loading?'Loading your doctors and visits…':'Visit data is unavailable. Refresh data to connect the updated backend.'}</p>:section==='history'?<History visits={snapshot.visits} camps={camps}/>:<section className="visit-builder">
      <div className="visit-heading"><div><p className="eyebrow">Daily call plan</p><h2>Log visits</h2></div><span>{visitDay(date)} · {visitDateLabel(date)}</span></div>
      <div className="visit-controls"><label>Visit date<input type="date" min={today} value={date} onChange={e=>{setDate(e.target.value||today);if(visitDay(e.target.value)==='Sunday')setSelected([]);}}/></label><label>Visit camp<select value={camp} onChange={e=>{setCamp(e.target.value);setSelected([]);setSpecialty('');}}><option value="">Select camp</option>{camps.map(c=><option key={c}>{c}</option>)}</select></label><button className={'button visit-no-visits '+(kind!=='Visit'?'selected':'')} aria-pressed={kind!=='Visit'} disabled={kind==='Sunday'} onClick={()=>{setNoVisits(v=>!v);setSelected([]);setError('');}}>No visits · {kind==='Sunday'?'Sunday':'Holiday or leave'}</button>{noVisits&&kind!=='Sunday'&&<label>No-visits reason<select value={reason} onChange={e=>setReason(e.target.value)}><option>Holiday</option><option>Leave</option></select></label>}</div>
      {date<today&&<p className="message error">Past dates cannot be logged. Choose today or a future date.</p>}
      {kind!=='Visit'?<p className="panel">{kind} entry: doctor selection is disabled and both counts will be zero.</p>:<>
        <div className="visit-controls visit-filters"><label>Find a doctor<input type="search" aria-label="Search doctors for visit" placeholder="Doctor, hospital or pharmacy" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>Call schedule<select value={schedule} onChange={e=>setSchedule(e.target.value)}><option value="">Any schedule</option>{schedules.map(s=><option key={s}>{s}</option>)}</select></label><label>Specialty<select value={specialty} onChange={e=>setSpecialty(e.target.value)}><option value="">All specialties</option>{specialties.map(s=><option key={s}>{s}</option>)}</select></label></div>
        <div className="visit-selection"><strong>{selected.length} selected</strong><span>Never visited first, then oldest visit</span><button className="text-button" onClick={()=>setSelected(ids=>[...new Set([...ids,...filtered.map(d=>d.id)])])}>Select visible</button><button className="text-button" onClick={()=>{const visibleIds=new Set(filtered.map(d=>d.id));setSelected(ids=>ids.filter(id=>!visibleIds.has(id)));}}>Clear visible</button><button className="text-button" onClick={()=>setSelected([])}>Clear all</button></div>
        <div className="visit-doctor-picker" role="listbox" aria-label="Doctors in selected camp" aria-multiselectable="true">{filtered.map(d=>{const recency=visitRecency(last.get(d.id),date);return <button key={d.id} role="option" aria-selected={selected.includes(d.id)} className={'visit-picker-doctor '+(selected.includes(d.id)?'selected':'')} onClick={()=>setSelected(ids=>ids.includes(d.id)?ids.filter(id=>id!==d.id):[...ids,d.id])}><span className="visit-check" aria-hidden="true">{selected.includes(d.id)?'✓':''}</span><span><strong>{d.name}</strong><small>{[d.specialties.join(', '),d.hospital,d.pharmacy].filter(Boolean).join(' · ')}</small><small className={recency.stale?'stale':''}>{recency.label}</small></span></button>;})}{!filtered.length&&<p className="scope-note">No doctors match this camp and filters. Try Any schedule or another camp.</p>}</div>
        <section className="panel visit-preview" aria-label="Live visit preview"><div className="visit-heading"><h3>{selectedDoctors.length} doctors · {pharmacies.length} pharmacies</h3><span>{camp||'No camp'}</span></div>{selectedDoctors.length?<div className="visit-preview-columns"><div><h4>Doctors</h4><ol>{selectedDoctors.map(d=><li key={d.id}>{d.name}</li>)}</ol></div><div><h4>Pharmacies</h4>{pharmacies.length?<ol>{pharmacies.map(p=><li key={p}>{p}</li>)}</ol>:<p>None linked</p>}</div></div>:<p className="scope-note">Select doctors to build this visit bundle.</p>}</section>
      </>}
      <button className="field-primary visit-save" disabled={saving||!camp||date<today||(kind==='Visit'&&!selected.length)} onClick={save}>{saving?'Saving on this device…':kind==='Visit'?'Save visit bundle':'Save no-visits day'}</button>
    </section>}
  </section>;
}
