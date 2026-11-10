import React, { useCallback, useEffect, useState } from 'react';
import { api, clearSession, getStoredUser, setStoredUser } from './api.js';
import Login from './components/Login.jsx';
import { Logo, Spinner, Toast } from './components/UI.jsx';
import Workspace from './components/Workspace.jsx';

export default function App() {
  const [user, setUser] = useState(() => getStoredUser());
  const [initializing, setInitializing] = useState(true);
  const [toast, setToast] = useState(null);
  const notify = useCallback((message, type = 'success') => setToast({ message, type, id: Date.now() }), []);

  useEffect(() => {
    let active = true;
    const storedUser = getStoredUser();
    // Siempre consultamos: la cookie puede restaurar la sesión aunque no exista token local.
    api('/auth/me')
      .then(data => {
        if (!active) return;
        setStoredUser(data.user);
        setUser(data.user);
      })
      .catch(error => {
        if (!active) return;
        if (error.status === 401) {
          // Una sesión antigua o inexistente vuelve al login sin mostrar una falsa alarma.
          clearSession();
          setUser(null);
        } else if (storedUser) {
          setUser(storedUser);
          notify('La conexión es inestable. Conservamos tu sesión mientras actualizamos los datos.', 'error');
        } else {
          notify(error.message, 'error');
        }
      })
      .finally(() => active && setInitializing(false));
    return () => { active = false; };
  }, [notify]);

  if (initializing && !user) return <div className="app-loading"><div className="loading-logo"><Logo light /></div><Spinner light size={24} /><span>Preparando tu espacio...</span></div>;
  const login = (loggedUser) => { setStoredUser(loggedUser); setUser(loggedUser); setInitializing(false); };
  const logout = () => {
    api('/auth/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    setUser(null);
    notify('Sesión cerrada. ¡Hasta pronto!');
  };
  return <>
    {user ? <Workspace user={user} onLogout={logout} notify={notify} /> : <Login onLogin={login} />}
    <Toast toast={toast} onClose={() => setToast(null)} />
  </>;
}
