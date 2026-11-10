import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Camera, ClipboardList, Home, LogOut, Plus, ShieldCheck, UserCircle, UsersRound } from 'lucide-react';
import { api } from '../api.js';
import AttendanceModal from './AttendanceModal.jsx';
import { Avatar, Logo } from './UI.jsx';
import Dashboard from '../views/Dashboard.jsx';
import Team from '../views/Team.jsx';
import Records from '../views/Records.jsx';
import Profile from '../views/Profile.jsx';
import Reports from '../views/Reports.jsx';

export default function Workspace({ user, onLogout, notify }) {
  const admin = user.role === 'superadmin';
  const [tab, setTab] = useState('home');
  const [dashboard, setDashboard] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [markOpen, setMarkOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, team] = await Promise.all([api('/dashboard'), admin ? api('/users') : Promise.resolve([])]);
      setDashboard(dash); setUsers(team);
    } catch (err) { notify(err.message, 'error'); }
    finally { setLoading(false); }
  }, [admin, notify]);
  useEffect(() => { refresh(); }, [refresh, refreshKey]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [tab]);

  const navItems = [
    { id: 'home', label: 'Inicio', icon: Home },
    ...(admin ? [{ id: 'team', label: 'Equipo', icon: UsersRound }] : []),
    { id: 'records', label: admin ? 'Registros' : 'Historial', icon: ClipboardList },
    ...(admin ? [{ id: 'reports', label: 'Reportes', icon: BarChart3 }] : []),
    { id: 'profile', label: 'Perfil', icon: UserCircle },
  ];
  const mobileNavItems = navItems.filter(item => item.id !== 'reports');
  const navigate = (next) => {
    setTab(next);
    if (next !== 'records') setSelectedUserId('all');
  };
  const viewRecords = (id = 'all') => { setSelectedUserId(String(id)); setMarkOpen(false); setTab('records'); };
  const recorded = (message) => { notify(message); setRefreshKey(k => k + 1); };

  return <div className="workspace">
    <aside className="desktop-sidebar">
      <div className="sidebar-logo"><Logo light /><span>ASISTENCIA</span></div>
      <button className="sidebar-mark" onClick={() => setMarkOpen(true)}><span><Plus size={22} /></span><div><strong>Nueva marcación</strong><small>Foto + GPS</small></div></button>
      <nav className="sidebar-nav"><span className="nav-section-label">MI ESPACIO</span>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={20} /><span>{label}</span>{tab === id && <i />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-security"><ShieldCheck size={17} /><span>Datos protegidos<br /><small>SQLite · Cifrado seguro</small></span></div><button className="sidebar-profile" onClick={() => navigate('profile')}><Avatar user={user} /><span><strong>{user.name}</strong><small>{user.position}</small></span><LogOut size={17} onClick={e => { e.stopPropagation(); onLogout(); }} /></button></div>
    </aside>

    <header className="mobile-header"><button className="mobile-logo-button" onClick={() => navigate('home')} aria-label="Ir al inicio"><Logo /></button><div className="mobile-header-right"><span className="secure-chip"><ShieldCheck size={14} /> Seguro</span><button onClick={() => navigate('profile')} aria-label="Abrir perfil"><Avatar user={user} /></button></div></header>

    <main className="workspace-main">
      {tab === 'home' && <Dashboard user={user} data={dashboard} loading={loading} onMark={() => setMarkOpen(true)} onNavigate={navigate} />}
      {tab === 'team' && admin && <Team users={users} currentUser={user} loading={loading} onRefresh={refresh} onViewRecords={viewRecords} notify={notify} />}
      {tab === 'records' && <Records user={user} users={users} refreshKey={refreshKey} selectedUserId={selectedUserId} onSelectedUserChange={setSelectedUserId} onOpenReports={() => navigate('reports')} />}
      {tab === 'reports' && admin && <Reports users={users} onBack={() => navigate('records')} />}
      {tab === 'profile' && <Profile user={user} onLogout={onLogout} onMark={() => setMarkOpen(true)} />}
    </main>

    <nav className={`mobile-bottom-nav ${!admin ? 'employee-nav' : ''}`} aria-label="Navegación principal">
      {mobileNavItems.slice(0, admin ? 2 : 1).map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => navigate(id)}><span><Icon size={21} /></span><small>{label}</small></button>)}
      <button className="mobile-mark-button" onClick={() => setMarkOpen(true)} aria-label="Marcar asistencia"><span><Camera size={25} /></span><small>Marcar</small></button>
      {mobileNavItems.slice(admin ? 2 : 1).map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => navigate(id)}><span><Icon size={21} /></span><small>{label}</small></button>)}
    </nav>

    {markOpen && <AttendanceModal user={user} onClose={() => setMarkOpen(false)} onRecorded={recorded} onViewHistory={() => viewRecords('all')} />}
  </div>;
}
