'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {WORK_PLACES, blankDailyRecord, calculateDailyReport, eveningReport, exportReportBackup,
  loadReportData, morningReport, offsetReportDate, offsetReportMonth, reportDateLabel,
  reportMonthLabel, reportToday, reportingWeek, saveReportData, validReportDate} from '../lib/daily-reports.js';

const number = value => new Intl.NumberFormat('en-IN').format(value);
const inputNumber = value => Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(String(value).replaceAll(',', '')) || 0)));

function Counter({label, value, onChange, disabled, note}) {
  const id = 'daily-counter-' + label.toLowerCase().replaceAll(' ', '-');
  return <div className="daily-counter"><label htmlFor={id}>{label}</label><div className="daily-counter-control">
    <button type="button" aria-label={'Decrease ' + label} disabled={disabled || !value} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
    <input id={id} aria-describedby={id + '-note'} type="number" min="0" step="1" value={value} disabled={disabled} onChange={e => onChange(inputNumber(e.target.value))}/>
    <button type="button" aria-label={'Increase ' + label} disabled={disabled} onClick={() => onChange(Math.min(Number.MAX_SAFE_INTEGER, value + 1))}>+</button>
    <button type="button" aria-label={'Add ten ' + label} disabled={disabled} onClick={() => onChange(Math.min(Number.MAX_SAFE_INTEGER, value + 10))}>+10</button>
  </div><small id={id + '-note'}>{note}</small></div>;
}

export default function DailyReports({visible}) {
  const [data, setData] = useState(null), [loadError, setLoadError] = useState('');
  const [dateKey, setDateKey] = useState(''), [today, setToday] = useState(''), [tab, setTab] = useState('morning');
  const [month, setMonth] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [copying, setCopying] = useState(false), [copied, setCopied] = useState(false);
  const current = useRef(null), dirty = useRef(false), timer = useRef(null), activeDate = useRef(''), todayRef = useRef('');
  const noticeTimer = useRef(null);

  const announce = useCallback(message => {
    setNotice(message); clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 5000);
  }, []);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (!dirty.current || !current.current) return true;
    try {
      saveReportData(window.localStorage, current.current);
      dirty.current = false; setError('');return true;
    } catch {
      setError('Your changes could not be saved in this browser. Keep this page open, retry saving, or download a backup.'); return false;
    }
  }, []);
  const change = useCallback(updater => {
    const next = updater(current.current);
    current.current = next; dirty.current = true; setData(next); setError(''); setCopied(false);
    clearTimeout(timer.current); timer.current = setTimeout(flush, 1000);
  }, [flush]);
  const initialize = useCallback(() => {
    try {
      const loaded = loadReportData(window.localStorage), day = reportToday();
      current.current = loaded; dirty.current = false; activeDate.current = day; todayRef.current = day;
      setData(loaded); setDateKey(day); setToday(day); setMonth(day.slice(0, 7)); setLoadError('');
    } catch {
      setLoadError('Your local daily reports could not be read. Enable browser storage and retry.');
    }
  }, []);
  useEffect(() => {initialize(); return () => {clearTimeout(timer.current); clearTimeout(noticeTimer.current);};}, [initialize]);
  useEffect(() => {
    function rollover() {
      const day = reportToday(), previous = todayRef.current;
      if (day === previous || !current.current) return;
      todayRef.current = day; setToday(day);
      if (activeDate.current === previous && flush()) {
        activeDate.current = day; setDateKey(day); setMonth(day.slice(0, 7));
        announce('Date updated to ' + reportDateLabel(day) + '.');
      }
    }
    function visibilityChange() {if (document.visibilityState === 'hidden') flush(); else rollover();}
    function beforeUnload(event) {if (!flush()) {event.preventDefault(); event.returnValue = '';}}
    const interval = setInterval(rollover, 20000);
    window.addEventListener('focus', rollover); window.addEventListener('pagehide', flush); window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', visibilityChange);
    return () => {clearInterval(interval); window.removeEventListener('focus', rollover); window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('visibilitychange', visibilityChange);};
  }, [flush, announce]);
  useEffect(() => {if (!visible) flush();}, [visible, flush]);

  function switchDate(next) {
    if (!validReportDate(next) || !flush()) return;
    activeDate.current = next; setDateKey(next); setMonth(next.slice(0, 7)); setCopied(false);
  }
  function editRecord(field, value) {
    if (dateKey < reportToday()) return;
    change(doc => {
      const existing = doc.records[dateKey] || blankDailyRecord(dateKey), timestamp = new Date().toISOString();
      return {...doc, records: {...doc.records, [dateKey]: {...existing, [field]: value, createdAt: existing.createdAt || timestamp, updatedAt: timestamp}}};
    });
  }
  async function copyReport() {
    if (!current.current.records[activeDate.current] && activeDate.current >= reportToday()) {
      const day = activeDate.current, timestamp = new Date().toISOString();
      change(doc => ({...doc, records: {...doc.records, [day]: {...blankDailyRecord(day), createdAt: timestamp, updatedAt: timestamp}}}));
    }
    if (!flush()) return;
    setCopying(true); setCopied(false);
    const doc = current.current, record = doc.records[activeDate.current] || blankDailyRecord(activeDate.current);
    const text = tab === 'morning' ? morningReport(record, doc.settings) : eveningReport(record, doc.settings, calculateDailyReport(doc, activeDate.current));
    try {
      let done = false;
      try {if (navigator.clipboard?.writeText) {await navigator.clipboard.writeText(text); done = true;}} catch {}
      if (!done) {
        const origin = document.activeElement, area = document.createElement('textarea');
        area.value = text; area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(area);
        try {area.focus(); area.select(); done = document.execCommand('copy');} finally {area.remove(); origin?.focus();}
      }
      if (!done) throw new Error('Select the report preview and copy it manually; clipboard access is unavailable.');
      setCopied(true); announce((tab === 'morning' ? 'Morning' : 'Evening') + ' report copied.');
    } catch (err) {announce(err.message || 'Could not copy. Select and copy the report preview.');}
    finally {setCopying(false);}
  }
  function downloadBackup() {
    try {
      const url = URL.createObjectURL(new Blob([exportReportBackup(current.current)], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = `medmetric-daily-reports-${reportToday()}.json`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce('Report backup downloaded.');
    } catch {announce('Could not download the report backup.');}
  }

  if (!visible) return null;
  if (!data) return <section className="panel daily-reports"><h2>Daily reports</h2><p role="status">{loadError || 'Loading your saved daily reports…'}</p>
    {loadError && <button className="button" onClick={initialize}>Retry storage</button>}
  </section>;
  const record = data.records[dateKey] || blankDailyRecord(dateKey), totals = calculateDailyReport(data, dateKey);
  const past = dateKey < today, week = reportingWeek(dateKey), records = Object.values(data.records).filter(r => r.dateKey.startsWith(month)).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  const sums = records.reduce((sum, r) => ({doctors: sum.doctors + r.doctors, chemists: sum.chemists + r.chemists, newConversions: sum.newConversions + r.newConversions, pob: sum.pob + r.pob}), {doctors: 0, chemists: 0, newConversions: 0, pob: 0});
  const preview = tab === 'morning' ? morningReport(record, data.settings) : eveningReport(record, data.settings, totals);

  return <section className="daily-reports" aria-label="Daily field reports">
    {error && <div className="daily-error" role="alert"><p>{error}</p><button className="button" onClick={flush}>Retry saving</button><button className="button" onClick={downloadBackup}>Download backup</button></div>}
    {notice && <p className="daily-notice" role="status">{notice}</p>}
    <div className="daily-tabs" role="tablist" aria-label="Daily report screens">{[['morning', '☀', 'Morning'], ['evening', '☾', 'Evening'], ['monthly', '▦', 'Monthly history']].map(([key, symbol, title]) => <button key={key} role="tab" id={'daily-tab-' + key} aria-selected={tab === key} aria-controls={'daily-panel-' + key} tabIndex={tab === key ? 0 : -1} onKeyDown={e => {const tabs = ['morning', 'evening', 'monthly']; let target; if (e.key === 'ArrowRight') target = tabs[(tabs.indexOf(key) + 1) % 3]; if (e.key === 'ArrowLeft') target = tabs[(tabs.indexOf(key) + 2) % 3]; if (e.key === 'Home') target = tabs[0]; if (e.key === 'End') target = tabs[2]; if (target) {e.preventDefault(); setTab(target); setCopied(false); document.getElementById('daily-tab-' + target)?.focus();}}} onClick={() => {setTab(key); setCopied(false);}}><span aria-hidden="true">{symbol}</span>{title}</button>)}</div>
    {tab !== 'monthly' ? <div role="tabpanel" id={'daily-panel-' + tab} aria-labelledby={'daily-tab-' + tab} className="daily-report-grid">
      <section className="panel daily-entry"><div className="daily-panel-heading"><div><p className="daily-eyebrow">{tab === 'morning' ? 'PLAN YOUR DAY' : 'TODAY’S ACTIVITY'}</p><h2>{tab === 'morning' ? 'Morning details' : 'Evening details'}</h2></div><span className="daily-week">{week.weekOrdinal} week</span></div>
        <div className="daily-date-control"><button className="button" aria-label="Previous report date" disabled={copying} onClick={() => switchDate(offsetReportDate(dateKey, -1))}>←</button><label>Report date<input type="date" value={dateKey} disabled={copying} onChange={e => switchDate(e.target.value)}/></label><button className="button" aria-label="Next report date" disabled={copying} onClick={() => switchDate(offsetReportDate(dateKey, 1))}>→</button><button className="button" disabled={dateKey === today || copying} onClick={() => switchDate(reportToday())}>Today</button></div>
        <p className="daily-date-note">{new Date(dateKey + 'T12:00:00Z').toLocaleDateString('en-IN', {weekday: 'long', timeZone: 'Asia/Kolkata'})} · Asia/Kolkata{dateKey > today ? ' · Planned date' : ''}</p>
        {past && <p className="daily-readonly">Past reports are read-only. You can still copy their messages.</p>}
        <label>Work place<select value={record.workPlace} disabled={past || copying} onChange={e => editRecord('workPlace', e.target.value)}>{WORK_PLACES.map(place => <option key={place}>{place}</option>)}</select></label>
        {tab === 'evening' && <div className="daily-fields"><Counter label="Doctors visited" value={record.doctors} disabled={past || copying} onChange={value => editRecord('doctors', value)} note={'Monthly cumulative: ' + number(totals.cumDoctors)}/><Counter label="Chemists visited" value={record.chemists} disabled={past || copying} onChange={value => editRecord('chemists', value)} note={'Monthly cumulative: ' + number(totals.cumChemists)}/><Counter label="New conversions" value={record.newConversions} disabled={past || copying} onChange={value => editRecord('newConversions', value)} note={week.weekOrdinal + ' week: ' + number(totals.weekCumConversions) + ' · This month: ' + number(totals.monthCumConversions)}/>
          <label className="daily-pob">Today’s POB · ₹<input type="number" min="0" step="1" value={record.pob} disabled={past || copying} onChange={e => editRecord('pob', inputNumber(e.target.value))}/><small>{data.settings.pobMode === 'monthly' ? 'Monthly' : 'Continuous'} cumulative: ₹{number(totals.cumPob)}</small></label></div>}
        <p className="daily-entry-help">{tab === 'morning' ? 'Choose your work place and copy the message. These details carry over to your evening report.' : 'Enter the day’s numbers once. Cumulative totals and the report update automatically.'}</p>
      </section>
      <section className="panel daily-preview"><div className="daily-panel-heading"><div><p className="daily-eyebrow">READY TO SHARE</p><h2>{tab === 'morning' ? 'Morning' : 'Evening'} report</h2></div><span className="daily-week">{reportDateLabel(dateKey)}</span></div><pre tabIndex="0" aria-label="Formatted report preview">{preview}</pre><button className="button daily-primary daily-copy" disabled={copying} onClick={copyReport}>{copying ? 'Copying…' : copied ? '✓ Report copied' : 'Copy ' + tab + ' report'}</button><p>Copy and paste into your usual message. Daily POB is the amount entered here in rupees.</p></section>
    </div> : <section role="tabpanel" id="daily-panel-monthly" aria-labelledby="daily-tab-monthly" className="daily-monthly"><div className="panel daily-month-heading"><button className="button" aria-label="Previous history month" onClick={() => setMonth(offsetReportMonth(month, -1))}>←</button><h2>{reportMonthLabel(month)}</h2><label className="daily-month-picker">History month<input type="month" value={month} onChange={e => {if (validReportDate(e.target.value + '-01')) setMonth(e.target.value);}}/></label><button className="button" aria-label="Next history month" onClick={() => setMonth(offsetReportMonth(month, 1))}>→</button></div>
      <div className="daily-month-stats">{[['Doctors', sums.doctors], ['Chemists', sums.chemists], ['Conversions', sums.newConversions], ['POB', '₹' + number(sums.pob)]].map(([label, value]) => <article className="panel" key={label}><p>{label}</p><strong>{typeof value === 'number' ? number(value) : value}</strong></article>)}</div><p className="daily-history-note">Daily entry totals · opening balances excluded · latest first</p>
      <section className="panel daily-history"><div className="daily-panel-heading"><h2>Daily records</h2><span className="daily-week">{records.length} {records.length === 1 ? 'day' : 'days'}</span></div>{records.length ? <div className="table-scroll"><table><thead><tr><th>Date</th><th>Work place</th><th>Doctors</th><th>Chemists</th><th>Conversions</th><th>POB · ₹</th><th>Report</th></tr></thead><tbody>{records.map(r => <tr key={r.dateKey}><td>{reportDateLabel(r.dateKey)}</td><td>{r.workPlace}</td><td>{number(r.doctors)}</td><td>{number(r.chemists)}</td><td>{number(r.newConversions)}</td><td>{number(r.pob)}</td><td><button type="button" onClick={() => {if (flush()) {switchDate(r.dateKey); setTab('evening');}}}>View report ↗</button></td></tr>)}</tbody></table></div> : <div className="daily-empty"><h3>No reports for this month</h3><p>Saved daily entries will appear here. Start with today’s morning or evening report.</p></div>}</section>
    </section>}
  </section>;
}
