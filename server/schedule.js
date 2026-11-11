export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const validWeeklySchedule = schedule => !!schedule && typeof schedule === 'object' && !Array.isArray(schedule) && Object.keys(schedule).length === 7 && DAYS.every(day => schedule[day] && validTime(schedule[day].entry) && validTime(schedule[day].exit));
export const shortTime = (value, fallback) => String(value || fallback || '').slice(0, 5);
export function weeklySchedule(user) {
  if (validWeeklySchedule(user.weekly_schedule)) return user.weekly_schedule;
  return Object.fromEntries(DAYS.map(day => [day, { entry: shortTime(user.scheduled_entry, '08:00'), exit: shortTime(user.scheduled_exit, '17:00') }]));
}
export function scheduleForDate(user, date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', weekday: 'long' }).format(new Date(date)).toLowerCase();
  return weeklySchedule(user)[weekday];
}
