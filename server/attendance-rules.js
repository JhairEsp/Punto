import { scheduleForDate, shortTime } from './schedule.js';

export const MARK_TYPES = ['entry', 'lunch_start', 'lunch_end', 'exit'];
export const MARK_LABELS = { entry: 'Entrada', exit: 'Salida', lunch_start: 'Inicio de almuerzo', lunch_end: 'Fin de almuerzo' };
export const limaDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export const atLima = (day, time) => new Date(`${day}T${shortTime(time)}:00-05:00`);
export const addDays = (day, amount) => new Date(new Date(`${day}T12:00:00Z`).getTime() + amount * 86400000).toISOString().slice(0, 10);
export const recordDay = row => row.work_day || limaDay(row.created_at);

// Pure state calculation shared by status, POST validation and tests. Never trust client time.
export function attendanceState(user, records, now = new Date()) {
  now = new Date(now);
  let day = limaDay(now);
  let schedule = scheduleForDate(user, now);
  const previous = records.find(row => row.type === 'entry' && recordDay(row) === addDays(day, -1));
  if (previous && shortTime(previous.scheduled_exit) < shortTime(previous.scheduled_entry)
    && !records.some(row => row.type === 'exit' && recordDay(row) === recordDay(previous))
    && now < atLima(day, schedule.entry)) {
    day = recordDay(previous);
    schedule = { entry: shortTime(previous.scheduled_entry), exit: shortTime(previous.scheduled_exit) };
  }
  const marks = records.filter(row => recordDay(row) === day);
  const has = type => marks.some(row => row.type === type);
  const entry = marks.find(row => row.type === 'entry');
  if (entry?.scheduled_entry && entry?.scheduled_exit) schedule = { entry: shortTime(entry.scheduled_entry), exit: shortTime(entry.scheduled_exit) };
  const deadline = new Date(atLima(day, schedule.entry).getTime() + 3600000);
  const lunchStart = atLima(day, '12:00'), lunchEnd = atLima(day, '13:00');
  const reasons = {
    entry: has('entry') ? 'Ya registraste tu entrada en esta jornada.' : now > deadline ? 'Sin marcar: venció el plazo de una hora desde tu ingreso programado.' : '',
    exit: !has('entry') ? 'Primero debes registrar tu entrada.' : has('exit') ? 'Ya registraste tu salida en esta jornada.' : '',
    lunch_start: !has('entry') ? 'Primero debes registrar tu entrada.' : has('exit') ? 'Tu jornada ya terminó.' : has('lunch_start') ? 'Ya iniciaste tu almuerzo.' : now < lunchStart || now >= lunchEnd ? 'El almuerzo solo puede iniciarse entre las 12:00 y las 13:00.' : '',
    lunch_end: !has('lunch_start') ? 'Primero debes iniciar tu almuerzo.' : has('lunch_end') ? 'Ya finalizaste tu almuerzo.' : has('exit') ? 'Tu jornada ya terminó.' : now < lunchEnd ? 'Debes finalizar tu almuerzo a las 13:00.' : '',
  };
  const allowedTypes = MARK_TYPES.filter(type => !reasons[type]);
  const nextType = has('entry') ? (allowedTypes.includes('lunch_end') ? 'lunch_end' : allowedTypes.includes('lunch_start') ? 'lunch_start' : 'exit') : 'entry';
  const lunchStatus = has('lunch_end') ? 'finished' : has('lunch_start') ? (now > lunchEnd ? 'overdue' : 'active') : 'not_started';
  return { workDay: day, scheduledEntry: schedule.entry, scheduledExit: schedule.exit, entryDeadline: deadline.toISOString(), missingEntry: !has('entry') && now > deadline, lunchStatus, allowedTypes, reasons, nextType, todayCount: marks.length, last: marks.at(-1) || null };
}

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
