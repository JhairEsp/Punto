import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, BarChart3, CalendarDays, Check, ChevronDown, ClipboardList, Clock3, Filter, LogIn, LogOut, Navigation, Search, TrendingUp, X } from 'lucide-react';
import { api, getToken } from '../api.js';
import AttendanceItem from '../components/AttendanceItem.jsx';
import { Avatar, CloseButton, EmptyState, Modal, Skeleton, Spinner } from '../components/UI.jsx';
import { formatDate, formatMinutes, formatTime, mapsUrl, todayInput } from '../utils.js';

export default function Records({ user, users, refreshKey, selectedUserId = 'all', onSelectedUserChange, onOpenReports }) {
  const admin = user.role === 'superadmin';
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayInput());
  const [type, setType] = useState('all');
  const [photo, setPhoto] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (type !== 'all') params.set('type', type);
    if (admin && selectedUserId !== 'all') params.set('userId', selectedUserId);
    api(`/attendance?${params}`).then(data => active && setRecords(data)).catch(err => active && setError(err.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [date, type, selectedUserId, refreshKey, admin]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await fetch('/api/export', { credentials: 'include', headers: { Authorization: `Bearer ${getToken()}`, 'X-Punto-Token': getToken() || '' } });
      if (!response.ok) throw new Error('No se pudo exportar.');
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a'); a.href = url; a.download = `asistencias-punto-${todayInput()}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); } finally { setExporting(false); }
  };
  const clearFilters = () => { setDate(''); setType('all'); onSelectedUserChange?.('all'); };
  const entries = records.filter(r => r.type === 'entry').length;
  const selectedPerson = users.find(u => String(u.id) === String(selectedUserId));

  return <div className="page records-page page-enter">
    <div className="page-title-row"><div><span className="section-kicker">TRAZABILIDAD COMPLETA</span><h1>Registros<span className="title-dot">.</span></h1><p>{admin ? 'Cada entrada y salida, respaldada con evidencia.' : 'Tu historial de jornada, siempre a la mano.'}</p></div><div className="record-header-actions">{admin && <button className="secondary-button export-button" onClick={onOpenReports} aria-label="Abrir reportes"><BarChart3 size={18} /><span>Reportes</span></button>}{admin && <button className="secondary-button export-button" onClick={exportCsv} disabled={exporting} aria-label="Exportar CSV">{exporting ? <Spinner /> : <ArrowDownToLine size={18} />}<span>Exportar CSV</span></button>}</div></div>

    <section className="records-summary"><div><span className="summary-icon total"><ClipboardList size={20} /></span><p>Marcaciones<strong>{records.length}</strong></p></div><div><span className="summary-icon entry"><LogIn size={20} /></span><p>Entradas<strong>{entries}</strong></p></div><div><span className="summary-icon exit"><LogOut size={20} /></span><p>Salidas<strong>{records.length - entries}</strong></p></div><div className="verified-summary"><span><Check size={15} /></span><p><strong>100% verificados</strong><small>Con foto y GPS</small></p></div></section>
    <div className="records-time-metrics"><span><Clock3 size={16} /><small>Tardanza acumulada</small><strong>{formatMinutes(records.reduce((sum, record) => sum + (record.lateMinutes || 0), 0))}</strong></span><span className="extra"><TrendingUp size={16} /><small>Tiempo extra acumulado</small><strong>{formatMinutes(records.reduce((sum, record) => sum + (record.overtimeMinutes || 0), 0))}</strong></span></div>

    <section className="filter-panel">
      <div className="filter-row"><label className="filter-control date-filter"><CalendarDays size={18} /><input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Filtrar por fecha" /></label>{admin && <label className="filter-control user-filter"><Search size={17} /><select value={selectedUserId} onChange={e => onSelectedUserChange(e.target.value)}><option value="all">Todo el equipo</option>{users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.position}</option>)}</select><ChevronDown size={16} /></label>}<div className="type-filter"><button className={type === 'all' ? 'active' : ''} onClick={() => setType('all')}>Todos</button><button className={type === 'entry' ? 'active' : ''} onClick={() => setType('entry')}>Entradas</button><button className={type === 'exit' ? 'active' : ''} onClick={() => setType('exit')}>Salidas</button></div></div>
      <div className="active-filter-line"><Filter size={14} /><span>{date ? (date === todayInput() ? 'Mostrando registros de hoy' : `Registros del ${formatDate(`${date}T12:00:00`, { day: 'numeric', month: 'long' })}`) : 'Mostrando todo el historial'}{selectedPerson ? ` · ${selectedPerson.name}` : ''}</span>{(date || type !== 'all' || selectedUserId !== 'all') && <button onClick={clearFilters}>Limpiar filtros <X size={13} /></button>}</div>
    </section>
    {error && <div className="form-error standalone-error">{error}</div>}

    <section className="content-card records-list-card">
      <div className="records-list-header"><span>{admin ? 'Colaborador' : 'Tipo de marcación'}</span><span>Evidencia</span></div>
      <div className="attendance-list records-list">
        {loading ? [1,2,3,4,5].map(i => <div className="attendance-skeleton" key={i}><Skeleton className="avatar-skeleton" /><div><Skeleton /><Skeleton /></div></div>) : records.length ? records.map(record => <AttendanceItem key={record.id} record={record} showUser={admin} onClick={setPhoto} />) : <EmptyState icon={ClipboardList} title="No hay marcaciones aquí" text={date || type !== 'all' || selectedUserId !== 'all' ? 'Prueba cambiando la fecha o limpiando los filtros.' : 'Las entradas y salidas aparecerán en este historial.'} action={(date || type !== 'all' || selectedUserId !== 'all') && <button className="small-primary" onClick={clearFilters}>Ver todo el historial</button>} />}
      </div>
    </section>

    {photo && <Modal onClose={() => setPhoto(null)} className="photo-detail-modal"><div className="photo-detail-image"><CloseButton onClick={() => setPhoto(null)} light /><img src={photo.photoUrl} alt="Evidencia fotográfica de asistencia" /><span className={`type-badge ${photo.type === 'entry' ? 'entry' : 'exit'}`}>{photo.type === 'entry' ? 'Entrada' : 'Salida'}</span><span className="photo-verified"><Check size={13} /> Foto verificada</span></div><div className="photo-detail-content"><div className="photo-detail-person"><Avatar user={admin ? photo : user} /><div><h3>{admin ? photo.name : user.name}</h3><p>{admin ? photo.position : user.position}</p></div><div className="photo-time"><strong>{formatTime(photo.created_at)}</strong><small>{formatDate(photo.created_at, { day: '2-digit', month: 'short', year: 'numeric' })}</small></div></div><div className={`schedule-result ${photo.type === 'entry' ? (photo.lateMinutes > 0 ? 'late' : 'ontime') : (photo.overtimeMinutes > 0 ? 'extra' : photo.earlyLeaveMinutes > 0 ? 'early' : 'ontime')}`}><Clock3 size={18} /><div><small>HORARIO · {photo.type === 'entry' ? photo.scheduledEntry : photo.scheduledExit}</small><strong>{photo.type === 'entry' ? (photo.lateMinutes > 0 ? `${formatMinutes(photo.lateMinutes)} de tardanza` : 'Llegada a tiempo') : (photo.overtimeMinutes > 0 ? `${formatMinutes(photo.overtimeMinutes)} de tiempo extra` : photo.earlyLeaveMinutes > 0 ? `${formatMinutes(photo.earlyLeaveMinutes)} de salida anticipada` : 'Salida puntual')}</strong></div></div><a className="location-detail" href={mapsUrl(photo)} target="_blank" rel="noreferrer"><span className="location-detail-icon"><Navigation size={19} /></span><span><strong>Abrir ubicación en Maps</strong><small>{photo.latitude.toFixed(6)}, {photo.longitude.toFixed(6)}{photo.accuracy ? ` · ±${Math.round(photo.accuracy)} m` : ''}</small></span><ArrowUpRight size={18} /></a><div className="evidence-note"><Check size={15} /> Registro íntegro · Foto, hora y coordenadas guardadas</div></div></Modal>}
  </div>;
}
