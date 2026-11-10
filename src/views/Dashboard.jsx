import React, { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, BarChart3, Camera, Check, ClipboardList, Clock3, LogIn, LogOut, MapPin, Navigation, Sparkles, TrendingUp, UsersRound } from 'lucide-react';
import AttendanceItem from '../components/AttendanceItem.jsx';
import { Avatar, CloseButton, EmptyState, Modal, Skeleton } from '../components/UI.jsx';
import { formatMinutes, formatTime, greeting, longToday, mapsUrl } from '../utils.js';

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(id); }, []);
  return <div className="live-clock"><span>{new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(time)}</span><small>HORA LOCAL · LIMA</small></div>;
}

export default function Dashboard({ user, data, loading, onMark, onNavigate }) {
  const [photo, setPhoto] = useState(null);
  const admin = user.role === 'superadmin';
  const stats = data?.stats || {};
  const cards = admin ? [
    { label: 'Presentes ahora', value: stats.present, icon: UsersRound, tone: 'green', note: `de ${stats.team || 0} colaboradores` },
    { label: 'Entradas hoy', value: stats.entries || 0, icon: LogIn, tone: 'blue', note: 'marcaciones verificadas' },
    { label: 'Salidas hoy', value: stats.exits || 0, icon: LogOut, tone: 'orange', note: 'jornadas cerradas' },
    { label: 'Equipo activo', value: stats.team || 0, icon: ClipboardList, tone: 'purple', note: 'usuarios habilitados' },
  ] : [
    { label: 'Mis entradas', value: stats.entries || 0, icon: LogIn, tone: 'green', note: 'registradas hoy' },
    { label: 'Mis salidas', value: stats.exits || 0, icon: LogOut, tone: 'orange', note: 'registradas hoy' },
    { label: 'Tardanza hoy', value: formatMinutes(stats.late_minutes), icon: Clock3, tone: 'orange', note: 'según tu horario', time: true },
    { label: 'Tiempo extra', value: formatMinutes(stats.overtime_minutes), icon: TrendingUp, tone: 'purple', note: 'acumulado hoy', time: true },
  ];
  const progress = stats.team ? Math.min(100, Math.round(((stats.present || 0) / stats.team) * 100)) : 0;

  return <div className="page dashboard-page page-enter">
    <div className="page-greeting"><div><p>{longToday()}</p><h1>{greeting()}, <span>{user.name.split(' ')[0]}.</span></h1></div><span className="greeting-spark"><Sparkles size={20} /></span></div>

    <section className="hero-card">
      <div className="hero-grid-pattern" /><div className="hero-glow" />
      <div className="hero-content">
        <div className="hero-status"><span className="live-dot" /> {admin ? 'PANEL EN TIEMPO REAL' : (stats.present ? 'TU JORNADA ESTÁ ACTIVA' : 'LISTO PARA COMENZAR')}</div>
        <div className="hero-main"><div><h2>{admin ? <>El ritmo de tu equipo,<br /><em>en un solo lugar.</em></> : <>Tu tiempo cuenta.<br /><em>Hazlo valer.</em></>}</h2><p>{admin ? 'Personas, ubicaciones y marcaciones. Todo claro desde el primer vistazo.' : 'Registra tu jornada de forma simple, segura y con total transparencia.'}</p></div><LiveClock /></div>
        <button className="hero-action" onClick={onMark}><span className="hero-action-icon"><Camera size={22} /></span><span><strong>Marcar asistencia</strong><small>Foto + ubicación GPS</small></span><ArrowRight size={20} /></button>
      </div>
      <div className="hero-pin" aria-hidden="true"><span className="pin-ring ring-a" /><span className="pin-ring ring-b" /><span className="pin-center"><MapPin size={28} /><Check size={13} /></span></div>
    </section>

    <div className={`stats-grid ${!admin ? 'stats-two' : ''}`}>
      {cards.map(({ label, value, icon: Icon, tone, note, time }, i) => <article className="stat-card" key={label} style={{ '--delay': `${i * 60}ms` }}><div className={`stat-icon ${tone}`}><Icon size={20} /></div><div className={`stat-value ${time ? 'stat-time' : ''}`}>{loading ? <Skeleton className="number-skeleton" /> : String(value ?? 0).padStart(2, '0')}</div><h3>{label}</h3><p>{note}</p></article>)}
    </div>

    <div className="dashboard-columns">
      <section className="content-card recent-card">
        <div className="section-heading"><div><span className="section-kicker">ACTIVIDAD</span><h2>{admin ? 'Últimas marcaciones' : 'Mi actividad reciente'}</h2></div><button className="text-button" onClick={() => onNavigate('records')}>Ver todo <ArrowUpRight size={16} /></button></div>
        <div className="attendance-list">
          {loading ? [1,2,3].map(i => <div className="attendance-skeleton" key={i}><Skeleton className="avatar-skeleton" /><div><Skeleton /><Skeleton /></div></div>) : data?.recent?.length ? data.recent.slice(0, 5).map(record => <AttendanceItem key={record.id} record={record} showUser={admin} onClick={setPhoto} compact />) : <EmptyState icon={Clock3} title="El día está por comenzar" text={admin ? 'Aquí aparecerán las entradas y salidas de tu equipo.' : 'Tu primera marcación del día aparecerá aquí.'} action={<button className="small-primary" onClick={onMark}><Camera size={16} /> Hacer una marcación</button>} />}
        </div>
      </section>

      <aside className="dashboard-aside">
        <section className="content-card team-pulse-card">
          <div className="section-heading"><div><span className="section-kicker">{admin ? 'PULSO DEL EQUIPO' : 'TU JORNADA'}</span><h2>{admin ? 'Asistencia de hoy' : 'Estado actual'}</h2></div></div>
          {admin ? <><div className="progress-wrap"><div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` }}><div><strong>{progress}%</strong><span>presente</span></div></div><div className="progress-copy"><strong>{stats.present || 0} de {stats.team || 0}</strong><span>colaboradores en jornada</span><div className="mini-avatars"><Avatar user={user} size="sm" /><span className="mini-avatar-more"><UsersRound size={15} /></span></div></div></div><button className="secondary-button full-width" onClick={() => onNavigate('team')}>Ver mi equipo <ArrowRight size={17} /></button><button className="report-link-button" onClick={() => onNavigate('reports')}><BarChart3 size={16} /> Ver reportes de asistencia <ArrowUpRight size={15} /></button></> : <><div className="employee-schedule"><Clock3 size={18} /><div><small>Tu horario asignado</small><strong>{user.scheduledEntry || '08:00'} <span>→</span> {user.scheduledExit || '17:00'}</strong></div></div><div className={`work-status-illustration ${stats.present ? 'active' : ''}`}><span><Navigation size={29} /></span><div><strong>{stats.present ? 'Jornada en curso' : 'Fuera de jornada'}</strong><p>{stats.present ? 'Tu entrada ya quedó registrada.' : 'Marca tu entrada cuando estés listo.'}</p></div></div><button className="secondary-button full-width" onClick={onMark}>{stats.present ? 'Registrar mi salida' : 'Registrar mi entrada'} <ArrowRight size={17} /></button></>}
        </section>
        <section className="trust-note"><span><MapPin size={19} /></span><div><strong>Ubicación con propósito</strong><p>El GPS se captura solo al marcar. Tu ubicación no se rastrea en segundo plano.</p></div></section>
      </aside>
    </div>

    {photo && <Modal onClose={() => setPhoto(null)} className="photo-detail-modal"><div className="photo-detail-image"><CloseButton onClick={() => setPhoto(null)} light /><img src={photo.photoUrl} alt="Registro de asistencia" /><span className={`type-badge ${photo.type === 'entry' ? 'entry' : 'exit'}`}>{photo.type === 'entry' ? 'Entrada' : 'Salida'}</span></div><div className="photo-detail-content"><div className="photo-detail-person"><Avatar user={admin ? photo : user} /><div><h3>{admin ? photo.name : user.name}</h3><p>{admin ? photo.position : user.position}</p></div><strong>{formatTime(photo.created_at)}</strong></div><a className="location-detail" href={mapsUrl(photo)} target="_blank" rel="noreferrer"><MapPin size={19} /><span><strong>Ubicación verificada</strong><small>{photo.latitude.toFixed(5)}, {photo.longitude.toFixed(5)}</small></span><ArrowUpRight size={18} /></a></div></Modal>}
  </div>;
}
