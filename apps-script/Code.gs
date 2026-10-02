/** MedMetric: authenticated, read-only Sheets backend for Vercel. */
const SOURCE_ID = '1dYodW1QJQBAXvFQph-zhA_iVIjmt_YFUFlbnuZhpluE';
const TABLES = [['MONTHLY_TOTALS',14],['SALES_RAW',19],['PRODUCT_CONFIG',12]];
function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return reply_({service:'MedMetric',ok:true}); }
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 2048) return reply_({ok:false,error:'Unauthorized'});
    const packet = JSON.parse(raw);
    const secret = PropertiesService.getScriptProperties().getProperty('MEDMETRIC_BACKEND_SECRET');
    if (!secret || secret.length < 32 || typeof packet.payload !== 'string' || !/^[a-f0-9]{64}$/.test(packet.signature || '')) return reply_({ok:false,error:'Unauthorized'});
    const expected = Utilities.computeHmacSha256Signature(packet.payload,secret,Utilities.Charset.UTF_8).map(b=>(b&255).toString(16).padStart(2,'0')).join('');
    let difference=0;
    for(let i=0;i<64;i++) difference |= expected.charCodeAt(i)^packet.signature.charCodeAt(i);
    if(difference) return reply_({ok:false,error:'Unauthorized'});
    const command=JSON.parse(packet.payload);
    if(command.action!=='read' || !Number.isSafeInteger(command.timestamp) || Math.abs(Date.now()-command.timestamp)>60000 || !/^[a-f0-9-]{36}$/.test(command.nonce || '')) return reply_({ok:false,error:'Unauthorized'});
    const lock=LockService.getScriptLock();
    if(!lock.tryLock(5000)) return reply_({ok:false,error:'Busy'});
    try {
      const cache=CacheService.getScriptCache();
      const key='request-'+command.nonce;
      if(cache.get(key)) return reply_({ok:false,error:'Unauthorized'});
      cache.put(key,'used',120);
    } finally { lock.releaseLock(); }
    const ss=SpreadsheetApp.openById(SOURCE_ID);
    const timezone=String(ss.getSpreadsheetTimeZone() || 'Asia/Kolkata');
    const valueRanges=TABLES.map(([name,width])=>{
      const sheet=ss.getSheetByName(name);
      if(!sheet) throw new Error('Missing table');
      const values=sheet.getRange(1,1,Math.max(1,sheet.getLastRow()),width).getValues().map(row=>row.map(value=>value instanceof Date ? Utilities.formatDate(value,timezone,'yyyy-MM-dd') : value));
      return {values};
    });
    return reply_({ok:true,valueRanges});
  } catch(error) { return reply_({ok:false,error:'Unable to read source spreadsheet'}); }
}
