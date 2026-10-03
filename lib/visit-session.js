import {visitBuild,visitHistory,visitSameIdentity} from './visits.js';

const emptyState=()=>({version:1,visits:[],queue:[],master:null});
// One IndexedDB record makes the visit and its outgoing operation atomic.
export function createVisitStore(indexedDB){
  let opening;
  function database(){
    if(!indexedDB)return Promise.reject(new Error('Visit storage is unavailable. Enable browser storage before saving.'));
    if(!opening)opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('medmetric-visits-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('state');
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
      request.onerror=()=>{opening=null;reject(new Error('Could not open visit storage. Your visit has not been saved.'));};
      request.onblocked=()=>{opening=null;reject(new Error('Close other MedMetric tabs and retry opening visit storage.'));};
    });return opening;
  }
  return {async change(update){
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('state','readwrite'),store=tx.objectStore('state');let result;
      const request=store.get('current');
      request.onsuccess=()=>{try{result=update(request.result||emptyState());store.put(result,'current');}catch(error){reject(error);tx.abort();}};
      tx.oncomplete=()=>resolve(result);
      tx.onerror=tx.onabort=()=>reject(new Error('Could not save visit data on this device. Your selection is still in the form.'));
    });
  }};
}
export function createVisitSession({store,request,uuid=()=>crypto.randomUUID(),now=()=>Date.now(),online=()=>true,schedule=setTimeout,cancel=clearTimeout,lock=work=>work()}){
  let state=emptyState(),view={...state,loading:true,error:'',syncing:false},listeners=new Set(),timer=null,serial=Promise.resolve(),stopped=false;
  function emit(patch={}){view={...state,...view,...state,...patch};listeners.forEach(fn=>fn());return view;}
  async function change(update){state=await store.change(update);emit();return state;}
  function exclusive(work){const pending=serial.catch(()=>{}).then(()=>lock(work));serial=pending;return pending;}
  function retryLater(){if(timer)cancel(timer);const next=state.queue.find(q=>!q.stopped);if(next&&!stopped&&online())timer=schedule(()=>{timer=null;void session.sync();},Math.min(30000,2000*2**Math.min(next.attempts,4)));}
  async function send(){
    if(!online()||stopped)return;
    emit({syncing:true});
    try{
      while(!stopped&&online()){
        await change(s=>s);
        const item=state.queue[0];if(!item||item.stopped)break;
        try{
          const response=await request({action:item.action,visit:{localId:item.visit.localId,date:item.visit.date,camp:item.visit.camp,kind:item.visit.kind,doctorIds:item.visit.doctorIds,createdAt:item.visit.createdAt}});
          if(!response.visit||!visitSameIdentity(response.visit,item.visit))throw new Error('The visit save response is incomplete. Retry with the same bundle.');
          await change(s=>({...s,queue:s.queue.filter(q=>q.opId!==item.opId),visits:s.queue.some(q=>q.opId!==item.opId&&q.visit.localId===item.visit.localId)?s.visits:[...s.visits.filter(v=>v.localId!==item.visit.localId),{...response.visit,syncState:'synced'}]}));
          emit({error:''});
        }catch(error){
          await change(s=>({...s,queue:s.queue.map(q=>q.opId===item.opId?{...q,attempts:q.attempts+1,stopped:error.permanent===true||q.attempts+1>=8,validation:error.permanent===true,error:error.message}:q)}));
          emit({error:error.message});break;
        }
      }
    }finally{emit({syncing:false});retryLater();}
  }
  const session={
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    snapshot(){return view;},
    resume(){stopped=false;},
    async start(){stopped=false;try{await change(s=>s);}catch(error){emit({loading:false,error:error.message});return;}await session.refresh();},
    stop(){stopped=true;if(timer)cancel(timer);timer=null;},
    async save(input){
      const visit=visitBuild({...input,localId:uuid(),createdAt:new Date(now()).toISOString()},state.master?.doctors||[],{camps:state.master?.camps||[]});
      if(!state.master)throw new Error('Load the doctor list before saving a visit.');
      const item={opId:uuid(),action:'save',visit,attempts:0,stopped:false};
      await change(s=>({...s,visits:[...s.visits,{...visit,syncState:'pending'}],queue:[...s.queue,item]}));
      emit({error:''});void session.sync();return visit;
    },
    async undo(visit){
      const item={opId:uuid(),action:'undo',visit,attempts:0,stopped:false};
      // Keep undo behind save, including when save is already in flight.
      await change(s=>({...s,visits:s.visits.map(v=>v.localId===visit.localId?{...v,active:false,syncState:'pending'}:v),queue:[...s.queue.filter(q=>!(q.action==='save'&&q.validation&&q.visit.localId===visit.localId)),item]}));
      void session.sync();
    },
    sync(){return exclusive(send).catch(error=>{emit({error:error.message});});},
    refresh(){return exclusive(async()=>{
      emit({loading:true});
      try{
        if(!online())return;
        const response=await request({action:'read'}),data=response.data;
        if(!data||data.schemaVersion!==1||!Array.isArray(data.doctors)||!Array.isArray(data.visits)||!Array.isArray(data.camps)||!Array.isArray(data.callSchedules))throw new Error('Update the existing Apps Script deployment to load Visits.');
        await change(s=>{const pending=new Set(s.queue.map(q=>q.visit.localId));return {...s,master:{doctors:data.doctors,camps:data.camps,callSchedules:data.callSchedules},visits:[...data.visits.filter(v=>!pending.has(v.localId)).map(v=>({...v,syncState:'synced'})),...s.visits.filter(v=>pending.has(v.localId))]};});
        emit({error:''});await send();
      }catch(error){emit({error:error.message});}
      finally{emit({loading:false});}
    }).catch(error=>{emit({loading:false,error:error.message});});},
    async retry(){await change(s=>({...s,queue:s.queue.map(q=>({...q,stopped:false,attempts:0}))}));emit({error:''});return session.refresh();},
    history(filters){return visitHistory(state.visits,filters);}
  };return session;
}
