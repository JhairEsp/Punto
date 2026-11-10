import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, Check, ChevronRight, Clock3, Edit3, KeyRound, MapPin, Plus, Search, ShieldCheck, UserCheck, UserRound, UsersRound, X } from 'lucide-react';
import { api } from '../api.js';
import { Avatar, CloseButton, EmptyState, Field, Modal, Skeleton, Spinner } from '../components/UI.jsx';
import { formatDate, formatTime } from '../utils.js';

const emptyForm = { name: '', username: '', position: '', password: '', scheduledEntry: '08:00', scheduledExit: '17:00' };

export default function Team({ users, currentUser, loading, onRefresh, onViewRecords, notify }) {
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', position: '', password: '', scheduledEntry: '08:00', scheduledExit: '17:00' });

  const filtered = useMemo(() => users.filter(u => `${u.name} ${u.username} ${u.position}`.toLowerCase().includes(search.toLowerCase())), [users, search]);
  useEffect(() => { if (selected) setSelected(users.find(u => u.id === selected.id) || null); }, [users]);

  const update = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const openAdd = () => { setForm(emptyForm); setError(''); setAddOpen(true); };
  const addUser = async (e) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await api('/users', { method: 'POST', body: JSON.stringify(form) });
      setAddOpen(false); notify(`¡${form.name} ya forma parte del equipo!`); onRefresh();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const openUser = (user) => { setSelected(user); setEditing(false); setEditForm({ name: user.name, position: user.position, password: '', scheduledEntry: user.scheduledEntry || '08:00', scheduledExit: user.scheduledExit || '17:00' }); setError(''); };
  const saveEdit = async (e) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const payload = { ...editForm }; if (!payload.password) delete payload.password;
      await api(`/users/${selected.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setEditing(false); notify('Datos del colaborador actualizados.'); onRefresh();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const toggleActive = async () => {
    setSaving(true);
    try {
      await api(`/users/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ active: !selected.active }) });
      notify(selected.active ? 'Cuenta desactivada.' : 'Cuenta activada nuevamente.'); onRefresh();
    } catch (err) { notify(err.message, 'error'); } finally { setSaving(false); }
  };

  return <div className="page team-page page-enter">
    <div className="page-title-row"><div><span className="section-kicker">PERSONAS Y ROLES</span><h1>Mi equipo<span className="title-dot">.</span></h1><p>Todo comienza con las personas adecuadas.</p></div><button className="primary-button add-user-button" onClick={openAdd} aria-label="Agregar usuario"><Plus size={19} /> <span>Agregar usuario</span></button></div>
    <div className="team-overview"><div className="team-overview-icon"><UsersRound size={25} /></div><div><strong>{users.filter(u => u.role === 'employee' && u.active).length}</strong><span>colaboradores activos</span></div><span className="overview-divider" /><div><strong>{users.filter(u => u.role === 'employee' && u.lastType === 'entry' && u.active).length}</strong><span>con jornada iniciada</span></div><div className="team-overview-decoration"><UserCheck size={45} /></div></div>
    <div className="toolbar"><label className="search-box"><Search size={19} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, usuario o puesto..." /><kbd>{filtered.length}</kbd></label></div>

    <div className="team-grid">
      {loading ? [1,2,3,4].map(i => <Skeleton className="user-card-skeleton" key={i} />) : filtered.length ? filtered.map(user => <button className={`user-card ${!user.active ? 'user-inactive' : ''}`} key={user.id} onClick={() => openUser(user)}>
        <div className="user-card-top"><Avatar user={user} size="lg" /><span className={`presence-dot ${user.lastType === 'entry' && user.active ? 'online' : ''}`} /><span className={`role-pill ${user.role === 'superadmin' ? 'admin' : ''}`}>{user.role === 'superadmin' ? <><ShieldCheck size={12} /> SuperAdmin</> : user.active ? 'Activo' : 'Inactivo'}</span></div>
        <div className="user-card-info"><h3>{user.name}{user.id === currentUser.id && <span>Tú</span>}</h3><p><BriefcaseBusiness size={14} /> {user.position}</p><small>@{user.username}</small></div>
        <div className="user-card-footer"><span>{user.lastAttendance ? <><Clock3 size={14} /> {formatDate(user.lastAttendance, { day: '2-digit', month: 'short' })} · {formatTime(user.lastAttendance)}</> : 'Sin marcaciones aún'}</span><ChevronRight size={18} /></div>
      </button>) : <div className="grid-empty"><EmptyState icon={UsersRound} title={search ? 'Sin coincidencias' : 'Tu equipo empieza aquí'} text={search ? 'Prueba con otro nombre, usuario o puesto.' : 'Agrega a tu primer colaborador para comenzar a registrar asistencias.'} action={!search && <button className="small-primary" onClick={openAdd}><Plus size={16} /> Agregar colaborador</button>} /></div>}
    </div>

    {addOpen && <Modal onClose={() => !saving && setAddOpen(false)} className="form-modal" labelledBy="add-user-title"><div className="modal-header"><div className="modal-heading-icon"><Plus size={22} /></div><div><span className="section-kicker">NUEVO INTEGRANTE</span><h2 id="add-user-title">Agregar al equipo</h2><p>Crea su acceso y define su puesto.</p></div><CloseButton onClick={() => setAddOpen(false)} /></div><form onSubmit={addUser} className="stack-form">
      <Field label="Nombre completo" icon={UserRound}><input required value={form.name} onChange={e => update('name', e.target.value)} placeholder="Ej. Andrea Salazar" autoFocus /></Field>
      <div className="form-two-columns"><Field label="Usuario" icon={UserRound}><input required value={form.username} onChange={e => update('username', e.target.value.replace(/\s/g, ''))} placeholder="andrea.s" autoCapitalize="none" /></Field><Field label="Puesto" icon={BriefcaseBusiness}><input required value={form.position} onChange={e => update('position', e.target.value)} placeholder="Ej. Ventas" list="positions" /></Field></div>
      <datalist id="positions"><option value="Administración" /><option value="Ventas" /><option value="Operaciones" /><option value="Marketing" /><option value="Soporte" /><option value="Logística" /></datalist>
      <Field label="Contraseña temporal" icon={KeyRound} hint="Mínimo 6 caracteres. Podrás cambiarla después."><input required minLength={6} type="text" value={form.password} onChange={e => update('password', e.target.value)} placeholder="Crea una contraseña segura" autoComplete="new-password" /></Field>
      <div className="schedule-form-block"><div className="schedule-form-title"><Clock3 size={17} /><div><strong>Horario de trabajo</strong><span>Se usará para calcular tardanzas y tiempo extra.</span></div></div><div className="form-two-columns"><Field label="Hora de ingreso"><input required type="time" value={form.scheduledEntry} onChange={e => update('scheduledEntry', e.target.value)} /></Field><Field label="Hora de salida"><input required type="time" value={form.scheduledExit} onChange={e => update('scheduledExit', e.target.value)} /></Field></div></div>
      <div className="form-info"><ShieldCheck size={17} /><span>La contraseña se almacena cifrada. Compártela solo con el colaborador.</span></div>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setAddOpen(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? <><Spinner light /> Guardando...</> : <><Plus size={18} /> Crear usuario</>}</button></div>
    </form></Modal>}

    {selected && <Modal onClose={() => setSelected(null)} className="user-detail-modal"><div className="user-detail-cover"><div className="cover-pattern" /><CloseButton onClick={() => setSelected(null)} light /><Avatar user={selected} size="xl" /><span className={`presence-dot large ${selected.lastType === 'entry' && selected.active ? 'online' : ''}`} /></div><div className="user-detail-body"><div className="user-detail-name"><h2>{selected.name}</h2><p>@{selected.username} · {selected.position}</p><span className={`role-pill ${selected.role === 'superadmin' ? 'admin' : ''}`}>{selected.active ? 'Cuenta activa' : 'Cuenta inactiva'}</span></div>
      <div className="user-mini-stats"><div><strong>{selected.attendanceCount || 0}</strong><span>Marcaciones</span></div><div><strong>{selected.lastType ? (selected.lastType === 'entry' ? 'Entrada' : 'Salida') : '—'}</strong><span>Último registro</span></div></div>
      <div className="schedule-summary"><Clock3 size={18} /><div><small>Horario asignado</small><strong>{selected.scheduledEntry || '08:00'} <span>→</span> {selected.scheduledExit || '17:00'}</strong></div></div>
      {error && <div className="form-error">{error}</div>}
      {editing ? <form className="stack-form edit-user-form" onSubmit={saveEdit}><Field label="Nombre completo"><input value={editForm.name} required onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></Field><Field label="Puesto"><input value={editForm.position} required onChange={e => setEditForm(f => ({ ...f, position: e.target.value }))} /></Field><div className="form-two-columns"><Field label="Hora de ingreso"><input type="time" required value={editForm.scheduledEntry} onChange={e => setEditForm(f => ({ ...f, scheduledEntry: e.target.value }))} /></Field><Field label="Hora de salida"><input type="time" required value={editForm.scheduledExit} onChange={e => setEditForm(f => ({ ...f, scheduledExit: e.target.value }))} /></Field></div><Field label="Nueva contraseña (opcional)"><input type="text" minLength={6} value={editForm.password} onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))} placeholder="Dejar vacío para conservar" /></Field><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? <Spinner light /> : <Check size={18} />} Guardar cambios</button></div></form> : <><div className="detail-actions"><button className="primary-button" onClick={() => { onViewRecords(selected.id); setSelected(null); }}><Clock3 size={18} /> Ver historial <ArrowRight size={17} /></button>{selected.role !== 'superadmin' && <button className="secondary-button square-button" onClick={() => setEditing(true)} aria-label="Editar usuario"><Edit3 size={18} /></button>}</div>{selected.role !== 'superadmin' && <button className="danger-text-button" disabled={saving} onClick={toggleActive}>{selected.active ? <X size={16} /> : <Check size={16} />}{selected.active ? 'Desactivar acceso' : 'Activar acceso'}</button>}</>}
    </div></Modal>}
  </div>;
}
