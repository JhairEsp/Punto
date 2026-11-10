import React, { useState } from 'react';
import { ArrowRight, Camera, Check, Eye, EyeOff, Fingerprint, LockKeyhole, MapPin, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { Logo, Spinner } from './UI.jsx';
import { api, setSession } from '../api.js';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return setError('Ingresa tu usuario y contraseña.');
    setLoading(true); setError('');
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      setSession(data.token, data.user);
      // Confirmamos la sesión antes de abrir el panel para evitar entradas y salidas inmediatas.
      try {
        const session = await api('/auth/me');
        onLogin(session.user);
      } catch {
        // Las credenciales ya fueron validadas; una comprobación secundaria no debe expulsar.
        onLogin(data.user);
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return <main className="login-page">
    <section className="login-visual">
      <div className="login-noise" />
      <div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" />
      <header className="login-brand"><Logo light /><span className="brand-tag">ASISTENCIA INTELIGENTE</span></header>
      <div className="login-message">
        <span className="eyebrow light"><Sparkles size={14} /> Tu equipo, en sincronía</span>
        <h1>Cada jornada<br />empieza <em>aquí.</em></h1>
        <p>Una forma más humana, simple y segura de registrar el tiempo que hace grande a tu equipo.</p>
      </div>
      <div className="login-preview" aria-hidden="true">
        <div className="preview-top"><div className="preview-person"><span className="preview-avatar"><Camera size={21} /></span><div><strong>Entrada registrada</strong><span>Hoy, justo a tiempo</span></div></div><span className="preview-time">08:00<span>AM</span></span></div>
        <div className="preview-meta"><span><span className="live-dot" /> GPS verificado</span><span><Check size={13} /> Foto validada</span></div>
        <div className="preview-location"><MapPin size={16} /><span>San Isidro, Lima</span><span className="location-line" /></div>
      </div>
      <div className="login-visual-footer"><ShieldCheck size={16} /><span>Privacidad y precisión en cada marcación</span></div>
    </section>

    <section className="login-panel">
      <div className="login-mobile-logo"><Logo /></div>
      <div className="login-form-wrap">
        <div className="login-heading"><span className="login-icon"><Fingerprint size={24} /></span><h2>Qué bueno verte.</h2><p>Ingresa a tu espacio de trabajo.</p></div>
        <form onSubmit={submit} className="login-form">
          <label className="login-field"><span>Usuario</span><div className="login-input"><UserRound size={19} /><input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" placeholder="Tu nombre de usuario" autoCapitalize="none" /></div></label>
          <label className="login-field"><span>Contraseña</span><div className="login-input"><LockKeyhole size={19} /><input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="Ingresa tu contraseña" /><button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{show ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></label>
          <div className={`login-error ${error ? 'visible' : ''}`} role="alert">{error || '\u00a0'}</div>
          <button className="primary-button login-button" disabled={loading}>{loading ? <><Spinner light /> Verificando...</> : <>Entrar a Punto <ArrowRight size={19} /></>}</button>
        </form>
        <div className="login-security"><ShieldCheck size={16} /><span>Conexión segura · Datos protegidos</span></div>
      </div>
      <footer className="login-footer">Hecho para equipos que avanzan <span>·</span> <strong>punto.</strong></footer>
    </section>
  </main>;
}
