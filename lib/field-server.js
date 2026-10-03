import {createHmac,randomUUID} from 'node:crypto';
import {backendConfigured,AppError,sheetPricing} from './sheets.js';
import {json} from './api.js';
export async function fieldBackend(command,fetcher=fetch) {
  if(!backendConfigured())throw new AppError(503,'The Google Sheets connection is not configured.');
  // Reads and creates can retry: activity IDs and doctor create-request IDs prevent duplicates.
  // Updates are not retried because their previous-record check must remain authoritative.
  const attempts=command.action==='field_read'||command.operation==='create'?2:1;
  for(let attempt=0;attempt<attempts;attempt++){
  try {
  const payload=JSON.stringify({...command,timestamp:Date.now(),nonce:randomUUID()});
  const signature=createHmac('sha256',process.env.MEDMETRIC_BACKEND_SECRET).update(payload).digest('hex');
  const response=await fetcher(process.env.APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature}),cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(24000)});
  if(!response.ok)throw new AppError(response.status>=500||response.status===429?502:503,'The field-data connection is unavailable.');
  let body;try{body=await response.json();}catch{throw new AppError(502,'The field-data connection returned an invalid response.');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError(502,'The field-data connection returned an invalid response.');
  if(!body.ok)throw new AppError(body.error==='Unauthorized'?503:422,body.error==='Unauthorized'?'Update the deployed Code.gs version to connect the new tracking tabs.':body.error||'Could not save field data.');
  if(command.action==='field_read'&&(!body.data||!Array.isArray(body.data.products)))throw new AppError(502,'The field-data response is incomplete.');
  if(command.action==='field_read'){const {priceList,...data}=body.data;body.data={...data,...sheetPricing(priceList)};}
  return body;
  }catch(error){
    const temporary=['TimeoutError','AbortError','TypeError'].includes(error.name)||error.status===502;
    if(temporary&&attempt+1<attempts)continue;
    if(['TimeoutError','AbortError'].includes(error.name))throw new AppError(504,command.action==='field_read'?'Google Sheets took too long to load. Retry connection; your saved records are unchanged.':'The save response timed out. Your entry is kept in the form. Refresh data to check whether it saved before editing again.');
    throw error;
  }
  }
}
export function shareFieldReads(loader){
  let pending=null;
  return command=>{
    if(command.action!=='field_read'||command.force)return loader(command);
    if(!pending)pending=Promise.resolve().then(()=>loader(command)).finally(()=>{pending=null;});
    return pending;
  };
}
const sharedBackend=shareFieldReads(fieldBackend);
export async function handleFields(request,loader=sharedBackend) {
  try{
    const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new AppError(403,'Cross-origin requests are not allowed.');
    if(!(request.headers.get('content-type')||'').startsWith('application/json'))throw new AppError(415,'Send JSON data.');
    const raw=await request.text();if(raw.length>12000)throw new AppError(413,'Record is too large.');
    let input;try{input=JSON.parse(raw);}catch{throw new AppError(400,'Invalid JSON.');}
    if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError(400,'Invalid request.');
    if(input.action==='read')return json(await loader({action:'field_read',force:input.force===true}));
    if(input.action!=='save'||!['create','update'].includes(input.operation)||typeof input.table!=='string'||!input.record||typeof input.record!=='object'||Array.isArray(input.record))throw new AppError(400,'Invalid save request.');
    // Public editing was explicitly requested. The backend validates fixed tables and foreign IDs under a lock.
    if(input.doctorProducts!==undefined&&input.table!=='DOCTORS')throw new AppError(400,'Prescribed products belong to a doctor save.');
    return json(await loader({action:'field_save',table:input.table,operation:input.operation,record:input.record,previous:input.previous,...(input.links!==undefined?{links:input.links}:{}),...(input.table==='DOCTORS'?{requestId:input.requestId,pharmacyName:input.pharmacyName,...(input.doctorProducts!==undefined?{doctorProducts:input.doctorProducts}:{})}:{})}));
  }catch(e){return json({error:e instanceof AppError?e.message:['TimeoutError','AbortError'].includes(e.name)?'Google Sheets took too long. Your entry is kept in the form; retry to check or save it.':'The field-data connection is unavailable. Your entry is kept in the form.'},e instanceof AppError?e.status:502);}
}
