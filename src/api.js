const TOKEN_KEY = 'punto_token';
const USER_KEY = 'punto_user';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getStoredUser = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { localStorage.removeItem(USER_KEY); return null; }
};
export const setToken = (token) => token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY);
export const setStoredUser = (user) => user
  ? localStorage.setItem(USER_KEY, JSON.stringify(user))
  : localStorage.removeItem(USER_KEY);
export const setSession = (token, user) => { setToken(token); setStoredUser(user); };
export const clearSession = () => { setToken(null); setStoredUser(null); };

export async function api(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['X-Punto-Token'] = token;
  }
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' });
  } catch {
    const error = new Error('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
    error.status = 0;
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || 'No se pudo completar la solicitud.');
    error.status = response.status;
    // La restauración de sesión se gestiona en App; nunca expulsamos desde una API secundaria.
    throw error;
  }
  return data;
}
