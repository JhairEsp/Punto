import { scheduleForDate, shortTime, limaDay, addDays, exitStatus, exitDeadline } from './schedule.js';

export const MARK_TYPES = ['entry', 'lunch_start', 'lunch_end', 'exit'];
export const MARK_LABELS = { entry: 'Entrada', exit: 'Salida', lunch_start: 'Inicio de almuerzo', lunch_end: 'Fin de almuerzo' };
export { limaDay, addDays } from './schedule.js';
export const atLima = (day, time) => new Date(`${day}T${shortTime(time)}:00-05:00`);
export const recordDay = row => row.work_day || limaDay(row.created_at);

// Pure state calculation shared by status, POST validation and tests. Never trust client time.
export function attendanceState(user, records, now = new Date()) {
  now = new Date(now);
  let day = limaDay(now);
  let schedule = scheduleForDate(user, now);
  records = [...records].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const previous = records.find(row => row.type === 'entry' && recordDay(row) === addDays(day, -1));
  const previousSchedule = previous ? { entry: shortTime(previous.scheduled_entry, scheduleForDate(user, previous.created_at).entry), exit: shortTime(previous.scheduled_exit, scheduleForDate(user, previous.created_at).exit) } : null;
  const previousExit = previous && exitStatus({ day: recordDay(previous), entryAt: previous.created_at, exitAt: records.find(row => row.type === 'exit' && recordDay(row) === recordDay(previous))?.created_at, schedule: previousSchedule, now });
  if (previous && previousExit.status === 'pending' && shortTime(previous.scheduled_exit) < shortTime(previous.scheduled_entry)
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
  const exit = marks.find(row => row.type === 'exit');
  const rule = exitStatus({ day, entryAt: entry?.created_at, exitAt: exit?.created_at, schedule, now });
  const missingExit = !!entry && !exit && rule.status === 'missing';
  const restDay = !entry && schedule.entry === schedule.exit;
  const closedMessage = 'El plazo de 5 minutos después de tu horario de salida venció: la jornada quedó como "sin marcar".';
  const reasons = {
    entry: has('entry') ? 'Ya registraste tu entrada en esta jornada.' : restDay ? 'Hoy es tu día de descanso.' : now > deadline ? 'Sin marcar: venció el plazo de una hora desde tu ingreso programado.' : '',
    exit: !has('entry') ? 'Primero debes registrar tu entrada.' : has('exit') ? 'Ya registraste tu salida en esta jornada.' : missingExit ? closedMessage : '',
    lunch_start: !has('entry') ? 'Primero debes registrar tu entrada.' : has('exit') ? 'Tu jornada ya terminó.' : missingExit ? closedMessage : has('lunch_start') ? 'Ya iniciaste tu almuerzo.' : now < lunchStart || now >= lunchEnd ? 'El almuerzo solo puede iniciarse entre las 12:00 y las 13:00.' : '',
    lunch_end: !has('lunch_start') ? 'Primero debes iniciar tu almuerzo.' : has('lunch_end') ? 'Ya finalizaste tu almuerzo.' : has('exit') ? 'Tu jornada ya terminó.' : missingExit ? closedMessage : now < lunchEnd ? 'Debes finalizar tu almuerzo a las 13:00.' : '',
  };
  const allowedTypes = MARK_TYPES.filter(type => !reasons[type]);
  const nextType = has('entry') ? (allowedTypes.includes('lunch_end') ? 'lunch_end' : allowedTypes.includes('lunch_start') ? 'lunch_start' : 'exit') : 'entry';
  const lunchStatus = has('lunch_end') ? 'finished' : has('lunch_start') ? (now > lunchEnd ? 'overdue' : 'active') : 'not_started';
  const prior = missingExit ? { day, rule } : !entry && previousExit?.status === 'missing' ? { day: recordDay(previous), rule: previousExit } : null;
  return { restDay, openShift: !!entry && !exit && !missingExit, missingExit, shiftClosed: missingExit, exitPending: !!entry && !exit && !missingExit, exitDeadline: rule.deadline || exitDeadline(schedule).deadline, exitDeadlineAt: rule.limitAt, priorExit: prior ? { day: prior.day, deadline: prior.rule.deadline, lateMark: prior.rule.lateMark, status: 'missing', message: closedMessage } : null, serverTime: now.toISOString(), workDay: day, scheduledEntry: schedule.entry, scheduledExit: schedule.exit, entryDeadline: deadline.toISOString(), missingEntry: !restDay && !has('entry') && now > deadline, lunchStatus, allowedTypes, reasons, nextType, todayCount: marks.length, last: marks.at(-1) || null };
}

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
