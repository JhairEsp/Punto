import React from 'react';
import { ArrowRight, BriefcaseBusiness, Camera, Check, ChevronRight, Clock3, Fingerprint, LogOut, MapPin, ShieldCheck, UserRound } from 'lucide-react';
import { Avatar } from '../components/UI.jsx';

export default function Profile({ user, onLogout, onMark }) {
  return <div className="page profile-page page-enter">
    <div className="page-title-row"><div><span className="section-kicker">TU ESPACIO</span><h1>Mi perfil<span className="title-dot">.</span></h1><p>Tu cuenta y preferencias de acceso.</p></div></div>
    <div className="profile-layout">
      <section className="profile-card"><div className="profile-card-pattern" /><div className="profile-avatar-wrap"><Avatar user={user} size="xxl" /><span><Check size={15} /></span></div><h2>{user.name}</h2><p>@{user.username}</p><span className="profile-role"><ShieldCheck size={15} /> {user.role === 'superadmin' ? 'SuperAdmin' : 'Colaborador'}</span><div className="profile-position"><BriefcaseBusiness size={17} /><span>{user.position}</span></div><button className="hero-action profile-mark-button" onClick={onMark}><span className="hero-action-icon"><Camera size={21} /></span><span><strong>Marcar asistencia</strong><small>Foto + ubicación GPS</small></span><ArrowRight size={19} /></button></section>
      <div className="profile-info-column">
        <section className="content-card account-card"><div className="section-heading"><div><span className="section-kicker">INFORMACIÓN</span><h2>Datos de la cuenta</h2></div></div><div className="account-row"><span><UserRound size={19} /></span><div><small>Nombre completo</small><strong>{user.name}</strong></div></div><div className="account-row"><span><Fingerprint size={19} /></span><div><small>Usuario de acceso</small><strong>{user.username}</strong></div></div><div className="account-row"><span><BriefcaseBusiness size={19} /></span><div><small>Puesto asignado</small><strong>{user.position}</strong></div></div><div className="account-row"><span><Clock3 size={19} /></span><div><small>Horario de trabajo</small><strong>{user.scheduledEntry || '08:00'} — {user.scheduledExit || '17:00'}</strong></div></div></section>
        <section className="content-card privacy-card"><div className="privacy-icon"><ShieldCheck size={25} /></div><div><h3>Tu privacidad importa</h3><p>La cámara y el GPS solo se activan cuando decides registrar una asistencia. Nunca rastreamos tu ubicación en segundo plano.</p><div className="privacy-chips"><span><Camera size={14} /> Captura voluntaria</span><span><MapPin size={14} /> GPS por marcación</span></div></div></section>
        <button className="logout-button" onClick={onLogout}><LogOut size={19} /><span>Cerrar sesión</span><ChevronRight size={18} /></button>
      </div>
    </div>
    <footer className="app-version"><span className="brand-mini-dot" /> Punto v1.0 <span>·</span> SQLite <span>·</span> Hecho para tu equipo</footer>
  </div>;
}
