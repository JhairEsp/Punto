import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, BarChart3, CalendarDays, Check, ChevronDown, Clock3, FileSpreadsheet, Filter, LogIn, LogOut, Search, Timer, TrendingUp, UserRound, UsersRound } from 'lucide-react';
import { api, getToken } from '../api.js';
import { Avatar, EmptyState, Skeleton, Spinner } from '../components/UI.jsx';
import { formatDate, formatMinutes, formatTime, monthInput, todayInput } from '../utils.js';

const currentMonth = monthInput();
const initialFrom = `${currentMonth}-01`;

export default function Reports({ users, onBack }) {
  const [mode, setMode] = useState('month');
  const [month, setMonth] = useState(currentMonth);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(todayInput());
  const [userId, setUserId] = useState('all');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [lastQuery, setLastQuery] = useState('');

  const load = async (config = { mode, month, from, to, userId }) => {
    setLoading(true); setError('');
    const params = new URLSearchParams();
    if (config.mode === 'month') params.set('month', config.month);
    else { params.set('from', config.from); params.set('to', config.to); }
    if (config.userId !== 'all') params.set('userId', config.userId);
    const query = params.toString();
    try {
      const data = await api(`/reports?${query}`);
      setReport(data); setLastQuery(query);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load({ mode: 'month', month: currentMonth, from: initialFrom, to: todayInput(), userId: 'all' }); }, []);

  const quick = (option) => {
    let config;
    if (option === 'today') {
      const today = todayInput();
      setMode('range'); setFrom(today); setTo(today);
      config = { mode: 'range', from: today, to: today, userId };
    } else {
      let selected = currentMonth;
      if (option === 'previous') {
        const [year, monthNumber] = currentMonth.split('-').map(Number);
        const previous = new Date(Date.UTC(year, monthNumber - 2, 1));
        selected = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
      }
      setMode('month'); setMonth(selected);
      config = { mode: 'month', month: selected, userId };
    }
    load(config);
  };
  const submit = (e) => { e.preventDefault(); load(); };
  const exportReport = async () => {
    setExporting(true); setError('');
    try {
      const response = await fetch(`/api/reports/export?${lastQuery}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${getToken()}`, 'X-Punto-Token': getToken() || '' },
      });
      if (!response.ok) { const data = await response.json(); throw new Error(data.message || 'No se pudo exportar.'); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `reporte-asistencia-${report.from}-${report.to}.csv`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
    finally { setExporting(false); }
  };
  const maxWorked = useMemo(() => Math.max(1, ...(report?.employees || []).map(employee => employee.workedMinutes)), [report]);
  const rangeLabel = report ? `${formatDate(`${report.from}T12:00:00`, { day: 'numeric', month: 'short' })} — ${formatDate(`${report.to}T12:00:00`, { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
  const summary = report?.summary || {};

  return <div className="page reports-page page-enter">
    <div className="page-title-row"><div><button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Registros</button><span className="section-kicker">ANÁLISIS DE ASISTENCIA</span><h1>Reportes<span className="title-dot">.</span></h1><p>Elige un mes o un rango exacto y obtén el detalle de tu equipo.</p></div><button className="secondary-button export-button" onClick={exportReport} disabled={!report || exporting || loading} aria-label="Descargar reporte CSV">{exporting ? <Spinner /> : <ArrowDownToLine size={18} />}<span>Descargar CSV</span></button></div>

    <div className="report-quick-filters"><span>Accesos rápidos</span><button onClick={() => quick('current')}>Este mes</button><button onClick={() => quick('previous')}>Mes pasado</button><button onClick={() => quick('today')}>Hoy</button></div>
    <form className="report-filter-card" onSubmit={submit}>
      <div className="report-mode-switch"><button type="button" className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}><CalendarDays size={16} /> Por mes</button><button type="button" className={mode === 'range' ? 'active' : ''} onClick={() => setMode('range')}><Filter size={16} /> Por días</button></div>
      <div className="report-filter-fields">
        {mode === 'month' ? <label className="report-month-filter"><span>Mes del reporte</span><div><CalendarDays size={17} /><input type="month" required value={month} onChange={e => setMonth(e.target.value)} /></div></label> : <><label><span>Desde</span><div><CalendarDays size={17} /><input type="date" required max={to} value={from} onChange={e => setFrom(e.target.value)} /></div></label><label><span>Hasta</span><div><CalendarDays size={17} /><input type="date" required min={from} value={to} onChange={e => setTo(e.target.value)} /></div></label></>}
        <label className="report-user-filter"><span>Colaborador</span><div><Search size={17} /><select value={userId} onChange={e => setUserId(e.target.value)}><option value="all">Todo el equipo</option>{users.map(user => <option key={user.id} value={user.id}>{user.name} · {user.position}</option>)}</select><ChevronDown size={15} /></div></label>
        <button className="primary-button report-generate" disabled={loading}>{loading ? <Spinner light /> : <BarChart3 size={18} />} Generar reporte</button>
      </div>
    </form>
    {error && <div className="form-error standalone-error">{error}</div>}

    {loading && !report ? <div className="report-loading"><Skeleton className="report-hero-skeleton" /><div className="stats-grid">{[1,2,3,4].map(i => <Skeleton className="user-card-skeleton" key={i} />)}</div></div> : report && <>
      <section className="report-hero"><div className="report-hero-pattern" /><div><span className="hero-status"><span className="live-dot" /> REPORTE GENERADO</span><h2>{rangeLabel}</h2><p>{summary.employees || 0} {summary.employees === 1 ? 'persona' : 'personas'} · {summary.records || 0} marcaciones con foto y GPS</p></div><div className="report-worked-total"><span><Timer size={23} /></span><div><small>TIEMPO TRABAJADO</small><strong>{formatMinutes(summary.workedMinutes)}</strong></div></div></section>
      <div className="stats-grid report-stats"><article className="stat-card"><div className="stat-icon green"><CalendarDays size={20} /></div><div className="stat-value">{summary.days || 0}</div><h3>Días registrados</h3><p>{summary.onTimeDays || 0} entradas puntuales</p></article><article className="stat-card"><div className="stat-icon blue"><UsersRound size={20} /></div><div className="stat-value">{summary.employees || 0}</div><h3>Colaboradores</h3><p>incluidos en el reporte</p></article><article className="stat-card"><div className="stat-icon orange"><Clock3 size={20} /></div><div className="stat-value stat-time">{formatMinutes(summary.lateMinutes)}</div><h3>Tardanza total</h3><p>{summary.lateDays || 0} llegadas tarde</p></article><article className="stat-card"><div className="stat-icon purple"><TrendingUp size={20} /></div><div className="stat-value stat-time">{formatMinutes(summary.overtimeMinutes)}</div><h3>Tiempo extra</h3><p>{formatMinutes(summary.earlyLeaveMinutes)} en salidas anticipadas</p></article></div>

      <section className="content-card report-employees-card"><div className="section-heading"><div><span className="section-kicker">RESUMEN POR PERSONA</span><h2>Rendimiento del equipo</h2></div><span className="report-count-pill">{report.employees.length}</span></div>{report.employees.length ? <div className="employee-report-list">{report.employees.map(employee => <article className="employee-report-row" key={employee.id}><Avatar user={employee} /><div className="employee-report-name"><strong>{employee.name}</strong><span>{employee.position} · {employee.days} {employee.days === 1 ? 'día' : 'días'}</span><div className="worked-bar"><i style={{ width: `${Math.max(3, employee.workedMinutes / maxWorked * 100)}%` }} /></div></div><div className="employee-report-metric"><small>Trabajado</small><strong>{formatMinutes(employee.workedMinutes)}</strong></div><div className="employee-report-metric late"><small>Tardanza</small><strong>{formatMinutes(employee.lateMinutes)}</strong></div><div className="employee-report-metric extra"><small>Extra</small><strong>{formatMinutes(employee.overtimeMinutes)}</strong></div></article>)}</div> : <EmptyState icon={UsersRound} title="Aún no hay datos" text="No encontramos marcaciones en este periodo." />}</section>

      <section className="content-card report-days-card"><div className="section-heading"><div><span className="section-kicker">DETALLE DÍA POR DÍA</span><h2>Jornadas del periodo</h2></div><span className="report-count-pill">{report.days.length}</span></div>{report.days.length ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Fecha / Colaborador</th><th>Horario</th><th>Entrada</th><th>Salida</th><th>Tardanza</th><th>Extra</th><th>Trabajado</th><th>Estado</th></tr></thead><tbody>{report.days.map(day => <tr key={`${day.userId}-${day.day}`}><td><div className="report-day-person"><Avatar user={day} size="sm" /><div><strong>{day.name}</strong><span>{formatDate(`${day.day}T12:00:00`, { weekday: 'short', day: '2-digit', month: 'short' })}</span></div></div></td><td><span className="schedule-cell">{day.scheduledEntry} — {day.scheduledExit}</span></td><td><span className="table-time entry"><LogIn size={13} />{day.firstEntry ? formatTime(day.firstEntry) : 'Pendiente'}</span></td><td><span className="table-time exit"><LogOut size={13} />{day.lastExit ? formatTime(day.lastExit) : 'Pendiente'}</span></td><td><span className={`table-minute ${day.lateMinutes ? 'late' : ''}`}>{day.lateMinutes ? formatMinutes(day.lateMinutes) : 'A tiempo'}</span></td><td><span className={`table-minute ${day.overtimeMinutes ? 'extra' : ''}`}>{day.overtimeMinutes ? formatMinutes(day.overtimeMinutes) : '—'}</span></td><td><strong className="worked-cell">{formatMinutes(day.workedMinutes)}</strong></td><td><span className={`day-status ${day.status}`}>{day.status === 'complete' ? <Check size={12} /> : <Clock3 size={12} />}{day.status === 'complete' ? 'Completo' : day.status === 'missing_exit' ? 'Sin salida' : 'Sin entrada'}</span></td></tr>)}</tbody></table></div> : <EmptyState icon={FileSpreadsheet} title="No hay jornadas en este periodo" text="Prueba seleccionando otro mes, otro rango de días o todo el equipo." />}</section>
      <div className="report-method-note"><Clock3 size={16} /><span>La tardanza y el tiempo extra se calculan con el horario guardado en cada marcación. Zona horaria: <strong>America/Lima</strong>.</span></div>
    </>}
  </div>;
}
