import {fieldBackend} from './field-server.js';
import {json} from './api.js';
import {AppError} from './sheets.js';
export async function handleVisits(request,loader=fieldBackend){
  try{
    if(request.method!=='POST')throw new AppError(405,'Use POST.');
    const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new AppError(403,'Cross-origin requests are not allowed.');
    if(!(request.headers.get('content-type')||'').startsWith('application/json'))throw new AppError(415,'Send JSON data.');
    const raw=await request.text();if(raw.length>12000)throw new AppError(413,'Visit bundle is too large.');
    let input;try{input=JSON.parse(raw);}catch{throw new AppError(400,'Invalid JSON.');}
    if(!input||typeof input!=='object'||Array.isArray(input)||!['read','save','undo'].includes(input.action))throw new AppError(400,'Invalid visit request.');
    if(input.action!=='read'&&(!input.visit||typeof input.visit!=='object'||Array.isArray(input.visit)))throw new AppError(400,'A visit bundle is required.');
    return json(await loader({action:input.action==='read'?'visits_read':'visits_write',...(input.action==='read'?{}:{operation:input.action,visit:input.visit})}));
  }catch(error){return json({error:error instanceof AppError?error.message:'The visit connection is unavailable. Saved local bundles will retry.',permanent:error instanceof AppError&&[400,403,413,415,422].includes(error.status)},error instanceof AppError?error.status:502);}
}
