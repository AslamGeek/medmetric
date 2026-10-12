import {json} from './api.js';
import {AppError} from './sheets.js';
import {fieldBackend} from './field-server.js';
import {DEFAULT_REPORT_SETTINGS,normalizeReportData} from './daily-reports.js';

function normalizeRecords(records,allowEmpty=false){
  if(!Array.isArray(records)||(!allowEmpty&&records.length<1)||records.length>25)throw new AppError(400,'Save up to 25 daily reports at a time.');
  const keyed={};
  for(const record of records){
    if(!record||typeof record!=='object'||Array.isArray(record)||typeof record.dateKey!=='string'||keyed[record.dateKey])throw new AppError(400,'Invalid or duplicate daily report.');
    keyed[record.dateKey]=record;
  }
  try{return Object.values(normalizeReportData({records:keyed,settings:DEFAULT_REPORT_SETTINGS,openingBalances:{}}).records);}
  catch(error){throw new AppError(422,error.message);}
}
function normalizeConfiguration(configuration){
  if(configuration==null)return null;
  if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))throw new AppError(422,'Invalid daily report configuration.');
  try{
    const normalized=normalizeReportData({records:{},settings:configuration.settings||DEFAULT_REPORT_SETTINGS,openingBalances:configuration.openingBalances||{},theme:configuration.theme});
    return {settings:normalized.settings,openingBalances:normalized.openingBalances,theme:normalized.theme};
  }catch(error){throw new AppError(422,error.message);}
}

export async function handleDailyReports(request,loader=fieldBackend){
  try{
    if(request.method!=='POST')return json({error:'Use POST.'},405);
    const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new AppError(403,'Cross-origin requests are not allowed.');
    if(!(request.headers.get('content-type')||'').startsWith('application/json'))throw new AppError(415,'Send JSON data.');
    const raw=await request.text();if(raw.length>12000)throw new AppError(413,'Request is too large.');
    let input;try{input=JSON.parse(raw);}catch{throw new AppError(400,'Invalid JSON.');}
    if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError(400,'Invalid request.');
    if(input.action==='read'){
      const result=await loader({action:'daily_read'});
      if(!Array.isArray(result.data?.records))throw new AppError(502,'Google Sheets returned an incomplete daily report list.');
      const records=result.data.records.length?normalizeRecords(result.data.records):[];
      return json({records,configuration:normalizeConfiguration(result.data.configuration)});
    }
    if(input.action!=='save'||input.records===undefined)throw new AppError(400,'Invalid daily report save request.');
    const records=normalizeRecords(input.records,true);
    const configuration=normalizeConfiguration(input.configuration)||{settings:DEFAULT_REPORT_SETTINGS,openingBalances:{},theme:'light'};
    const result=await loader({action:'daily_write',records,configuration});
    if(!Array.isArray(result.records))throw new AppError(502,'Google Sheets returned an incomplete daily report save.');
    return json({records:normalizeRecords(result.records),configuration:normalizeConfiguration(result.configuration)||configuration});
  }catch(error){
    if(error instanceof AppError)return json({error:error.message},error.status);
    if(['TimeoutError','AbortError'].includes(error.name))return json({error:'Google Sheets took too long. Your report remains saved on this device and will retry.'},504);
    return json({error:'Google Sheets could not save the daily report. Your report remains saved on this device.'},502);
  }
}
