export const DAILY_REPORT_KEY = 'medmetric-daily-reports-v1';
export const WORK_PLACES = ['Proddatur', 'Jammalamadugu', 'Kamalapuram / Yerraguntla', 'Mydukuru /GV Satram', 'Porumamilla /Kalasapaadu'];
export const DEFAULT_REPORT_SETTINGS = {name: 'Aslam K. S.', hq: 'Proddatur', timeZone: 'Asia/Kolkata', pobMode: 'monthly', continuousPobOpeningBalance: 0};

export function reportToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function validReportDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function reportDateLabel(value) {
  return value.split('-').reverse().join('-');
}
export function reportMonthLabel(value) {
  return new Date(value + '-01T12:00:00Z').toLocaleDateString('en-IN', {month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata'});
}
export function offsetReportDate(value, amount) {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function offsetReportMonth(value, amount) {
  const date = new Date(value + '-01T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}
export function reportingWeek(value) {
  const day = Number(value.slice(8));
  const weekNumber = Math.min(4, Math.ceil(day / 7));
  return {weekNumber, weekOrdinal: ['1st', '2nd', '3rd', '4th'][weekNumber - 1], startDay: (weekNumber - 1) * 7 + 1};
}
function wholeNumber(value, label) {
  const number = typeof value === 'string' && /^\d[\d,]*$/.test(value.trim()) ? Number(value.replaceAll(',', '').trim()) : value;
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} must be a non-negative whole number.`);
  return number;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
export function blankDailyRecord(dateKey) {
  return {dateKey, workPlace: WORK_PLACES[0], doctors: 0, chemists: 0, newConversions: 0, pob: 0};
}
export function blankReportData() {
  return {version: 1, records: {}, settings: {...DEFAULT_REPORT_SETTINGS}, openingBalances: {}, theme: 'light'};
}
export function normalizeReportData(input) {
  const data = object(input, 'report backup');
  if (data.version !== undefined && ![1, '1.1.0'].includes(data.version)) throw new Error('This report backup version is not supported.');
  const rawRecords = object(data.records, 'daily records');
  const rawSettings = object(data.settings, 'report settings');
  const rawBalances = object(data.openingBalances, 'opening balances');
  const records = {}, openingBalances = {};
  for (const [key, raw] of Object.entries(rawRecords)) {
    object(raw, 'daily record');
    if (!validReportDate(key) || raw.dateKey !== key) throw new Error('A daily record contains an invalid date.');
    if (!WORK_PLACES.includes(raw.workPlace)) throw new Error(`Unknown work place for ${key}.`);
    records[key] = {dateKey: key, workPlace: raw.workPlace,
      doctors: wholeNumber(raw.doctors, 'Doctors'), chemists: wholeNumber(raw.chemists, 'Chemists'),
      newConversions: wholeNumber(raw.newConversions, 'Conversions'), pob: wholeNumber(raw.pob, 'POB'),
      ...(typeof raw.createdAt === 'string' ? {createdAt: raw.createdAt} : {}),
      ...(typeof raw.updatedAt === 'string' ? {updatedAt: raw.updatedAt} : {})};
  }
  for (const [key, raw] of Object.entries(rawBalances)) {
    object(raw, 'opening balance');
    if (!validReportDate(key + '-01') || raw.monthKey !== key) throw new Error('An opening balance contains an invalid month.');
    openingBalances[key] = {monthKey: key, doctorsOpening: wholeNumber(raw.doctorsOpening, 'Doctor opening'),
      chemistsOpening: wholeNumber(raw.chemistsOpening, 'Chemist opening'), pobOpening: wholeNumber(raw.pobOpening, 'POB opening')};
  }
  if (!['monthly', 'continuous'].includes(rawSettings.pobMode)) throw new Error('Invalid POB calculation mode.');
  if (typeof rawSettings.name !== 'string' || typeof rawSettings.hq !== 'string') throw new Error('Invalid name or HQ in report settings.');
  const settings = {name: rawSettings.name.trim(), hq: rawSettings.hq.trim(), timeZone: 'Asia/Kolkata',
    pobMode: rawSettings.pobMode, continuousPobOpeningBalance: wholeNumber(rawSettings.continuousPobOpeningBalance ?? 0, 'Continuous POB opening')};
  return {version: 1, records, settings, openingBalances, theme: data.theme === 'dark' ? 'dark' : 'light'};
}
export function loadReportData(storage) {
  const saved = storage.getItem(DAILY_REPORT_KEY);
  if (saved) return normalizeReportData(JSON.parse(saved));
  // Recognize dfr2 data when both applications have been served on the same origin.
  const records = storage.getItem('dfwr_local_records');
  if (records) return normalizeReportData({version: '1.1.0', records: JSON.parse(records),
    settings: JSON.parse(storage.getItem('dfwr_local_settings') || JSON.stringify(DEFAULT_REPORT_SETTINGS)),
    openingBalances: JSON.parse(storage.getItem('dfwr_local_opening_balances') || '{}'),
    theme: storage.getItem('dfr_theme_mode')});
  return blankReportData();
}
export function saveReportData(storage, data) {
  const normalized = normalizeReportData(data);
  // One atomic storage write: a rejected write must propagate to the save indicator.
  storage.setItem(DAILY_REPORT_KEY, JSON.stringify(normalized));
  return normalized;
}
export function calculateDailyReport(data, selectedDate) {
  const month = selectedDate.slice(0, 7), week = reportingWeek(selectedDate);
  const opening = data.openingBalances[month] || {};
  const result = {cumDoctors: opening.doctorsOpening || 0, cumChemists: opening.chemistsOpening || 0,
    cumPob: data.settings.pobMode === 'continuous' ? data.settings.continuousPobOpeningBalance : opening.pobOpening || 0,
    weekCumConversions: 0, monthCumConversions: 0, ...week};
  for (const record of Object.values(data.records)) {
    if (record.dateKey > selectedDate) continue;
    if (data.settings.pobMode === 'continuous') result.cumPob += record.pob;
    if (record.dateKey.slice(0, 7) !== month) continue;
    result.cumDoctors += record.doctors;
    result.cumChemists += record.chemists;
    result.monthCumConversions += record.newConversions;
    if (Number(record.dateKey.slice(8)) >= week.startDay) result.weekCumConversions += record.newConversions;
    if (data.settings.pobMode === 'monthly') result.cumPob += record.pob;
  }
  return result;
}
export function morningReport(record, settings) {
  return `Good Morning Sir!\n\nToday's Daily Work Report\n\nName : ${settings.name}\nHQ : ${settings.hq}\nWork Place : ${record.workPlace}\nDate : ${reportDateLabel(record.dateKey)}`;
}
export function eveningReport(record, settings, totals) {
  return `Good Evening Sir!\n\nToday's Daily Work Report\n\nDate : ${reportDateLabel(record.dateKey)}\nName : ${settings.name}\nHQ : ${settings.hq}\nWork Place : ${record.workPlace}\nNo. of Drs Visited : ${record.doctors}\nCum Drs. : ${totals.cumDoctors}\nNo. of Chs. : ${record.chemists}\nCum Chs. : ${totals.cumChemists}\n${totals.weekOrdinal} Week New Conversions : ${record.newConversions}\n${totals.weekOrdinal} Week Cum New Conversions : ${totals.weekCumConversions}\nTotal New Conversions : ${totals.monthCumConversions}\nToday's POB : ${record.pob}\nCum POB : ${totals.cumPob}\n\nTHANK YOU\nGOOD NIGHT SIR`;
}
export function exportReportBackup(data) {
  return JSON.stringify({...normalizeReportData(data), exportedAt: new Date().toISOString(), storageType: 'device-local'}, null, 2);
}
