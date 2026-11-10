export const LIMA_TZ = 'America/Lima';
export const todayInput = () => new Intl.DateTimeFormat('en-CA', { timeZone: LIMA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const formatTime = (date, seconds = false) => new Intl.DateTimeFormat('es-PE', { timeZone: LIMA_TZ, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true }).format(new Date(date));
export const formatDate = (date, options = {}) => new Intl.DateTimeFormat('es-PE', { timeZone: LIMA_TZ, ...options }).format(new Date(date));
export const longToday = () => {
  const value = formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' });
  return value.charAt(0).toUpperCase() + value.slice(1);
};
export const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
export const shortDate = (date) => {
  const day = formatDate(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = formatDate(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit' });
  const yesterday = formatDate(new Date(Date.now() - 86400000), { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (day === today) return 'Hoy';
  if (day === yesterday) return 'Ayer';
  return formatDate(date, { day: '2-digit', month: 'short' }).replace('.', '');
};
export const monthInput = () => todayInput().slice(0, 7);
export const formatMinutes = (minutes = 0) => {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};
export const mapsUrl = (record) => `https://www.google.com/maps?q=${record.latitude},${record.longitude}`;
export const greeting = () => {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: LIMA_TZ, hour: '2-digit', hour12: false }).format(new Date()));
  return hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
};
