import { scheduleForDate, exitStatus, exitDeadline } from './schedule.js';
import { addDays, atLima, limaDay, recordDay, validDate } from './attendance-rules.js';

export const STATUS_LABELS = { complete: 'Completo', missing_exit: 'Sin marcar (salida)', pending_exit: 'Dentro del plazo', missing_entry: 'Sin marcar', pending: 'Pendiente' };
export const LUNCH_LABELS = { complete: 'Finalizado', late: 'Retorno tardío', missing_end: 'Sin finalizar', active: 'En almuerzo', not_started: 'Sin registro' };
export function reportRange(query, now = new Date()) {
  const month = String(query.month || (!query.from && !query.to ? limaDay(now).slice(0, 7) : ''));
  let from = String(query.from || ''), to = String(query.to || '');
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Object.assign(new Error('Selecciona un mes válido.'), { status: 400 });
    const [year, number] = month.split('-').map(Number);
    from = `${month}-01`;
    to = `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0')}`;
  }
  if (!validDate(from) || !validDate(to) || from > to) throw Object.assign(new Error('Selecciona un rango de fechas válido.'), { status: 400 });
  if ((new Date(to) - new Date(from)) / 86400000 > 365) throw Object.assign(new Error('El rango máximo es de 366 días. Divide el reporte en periodos menores.'), { status: 400 });
  return { from, to };
}

export function summarizeReport({ from, to, rows, users, now = new Date() }) {
  now = new Date(now);
  const grouped = new Map();
  const userMap = new Map(users.map(u => [u.id, u]));
  const ensure = (user, day, row) => {
    const key = `${user.id}:${day}`;
    if (!grouped.has(key)) {
      if (grouped.size >= 50000) throw Object.assign(new Error('El reporte supera las 50 000 jornadas. Selecciona menos días o un colaborador.'), { status: 400 });
      const schedule = scheduleForDate(user, `${day}T12:00:00Z`);
      grouped.set(key, { userId: user.id, name: user.name, username: user.username, position: user.position, avatarColor: user.avatar_color, day, scheduledEntry: row?.scheduledEntry || schedule.entry, scheduledExit: row?.scheduledExit || schedule.exit, marks: [] });
    }
    return grouped.get(key);
  };
  for (const row of rows) {
    const day = recordDay(row);
    if (day < from || day > to) continue;
    const user = userMap.get(row.user_id) || { id: row.user_id, ...row };
    ensure(user, day, row).marks.push(row);
  }
  // Missing attendance is a derived state, not a fake photo/GPS event. No cron required.
  // Historical records of inactive users remain visible; absences use today's active roster.
  for (const user of users.filter(u => u.active && u.role === 'employee')) {
    for (let day = from; day <= to && day <= limaDay(now); day = addDays(day, 1)) {
      if (user.created_at && day < limaDay(user.created_at)) continue;
      const schedule = scheduleForDate(user, `${day}T12:00:00Z`);
      if (schedule.entry === schedule.exit) continue;
      ensure(user, day);
    }
  }
  const days = [...grouped.values()].map(({ marks, ...group }) => {
    marks.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const firstEntry = marks.find(r => r.type === 'entry');
    const lastExit = marks.filter(r => r.type === 'exit').at(-1);
    const lunchStart = marks.find(r => r.type === 'lunch_start');
    const lunchEnd = marks.find(r => r.type === 'lunch_end');
    const lunchDeadline = atLima(group.day, '13:00');
    const gross = firstEntry && lastExit ? Math.max(0, (new Date(lastExit.created_at) - new Date(firstEntry.created_at)) / 60000) : 0;
    const breakEnd = lunchEnd || lastExit;
    const lunchMinutes = lunchStart && breakEnd ? Math.max(0, (Math.min(new Date(breakEnd.created_at), lastExit ? new Date(lastExit.created_at) : Infinity) - new Date(lunchStart.created_at)) / 60000) : 0;
    const deadline = new Date(atLima(group.day, group.scheduledEntry).getTime() + 3600000);
    const schedule = { entry: group.scheduledEntry, exit: group.scheduledExit };
    const rule = exitStatus({ day: group.day, entryAt: firstEntry?.created_at, exitAt: lastExit?.created_at, schedule, now });
    return { ...group,
      exitDeadline: rule.deadline || exitDeadline(schedule).deadline, exitDeadlineAt: rule.limitAt, exitLateMark: !!rule.lateMark,
      firstEntry: firstEntry?.created_at || null, lastExit: lastExit?.created_at || null,
      lunchStart: lunchStart?.created_at || null, lunchEnd: lunchEnd?.created_at || null,
      lunchMinutes: Math.floor(lunchMinutes), lunchLateMinutes: lunchEnd ? Math.max(0, Math.floor((new Date(lunchEnd.created_at) - lunchDeadline) / 60000)) : 0,
      lunchStatus: lunchEnd ? (new Date(lunchEnd.created_at) > lunchDeadline ? 'late' : 'complete') : lunchStart ? (now > lunchDeadline ? 'missing_end' : 'active') : 'not_started',
      lateMinutes: firstEntry?.late_minutes || 0, overtimeMinutes: lastExit?.overtime_minutes || 0, earlyLeaveMinutes: lastExit?.early_leave_minutes || 0,
      workedMinutes: Math.max(0, Math.floor(gross - lunchMinutes)), records: marks.length,
      status: firstEntry ? (lastExit ? 'complete' : rule.status === 'missing' ? 'missing_exit' : 'pending_exit') : now > deadline ? 'missing_entry' : 'pending',
    };
  }).sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name));
  const employees = new Map();
  for (const day of days) {
    if (!employees.has(day.userId)) employees.set(day.userId, { id: day.userId, name: day.name, username: day.username, position: day.position, avatarColor: day.avatarColor, days: 0, missingDays: 0, lateDays: 0, lateMinutes: 0, overtimeMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 0, lunchLateMinutes: 0, missingLunchEnds: 0 });
    const employee = employees.get(day.userId);
    employee.days += day.firstEntry ? 1 : 0;
    employee.missingDays += ['missing_entry', 'missing_exit'].includes(day.status) ? 1 : 0;
    employee.lateDays += day.lateMinutes > 0 ? 1 : 0;
    employee.missingLunchEnds += day.lunchStatus === 'missing_end' ? 1 : 0;
    for (const key of ['lateMinutes', 'overtimeMinutes', 'earlyLeaveMinutes', 'workedMinutes', 'lunchLateMinutes']) employee[key] += day[key];
  }
  const sum = key => days.reduce((total, day) => total + day[key], 0);
  return { from, to, days, employees: [...employees.values()].sort((a, b) => b.workedMinutes - a.workedMinutes || a.name.localeCompare(b.name)), summary: {
    employees: employees.size, days: days.length, records: sum('records'),
    missingDays: days.filter(d => ['missing_entry', 'missing_exit'].includes(d.status)).length,
    unmarkedDays: days.filter(d => ['missing_entry', 'missing_exit'].includes(d.status)).length,
    missingEntryDays: days.filter(d => d.status === 'missing_entry').length,
    missingExitDays: days.filter(d => d.status === 'missing_exit').length,
    pendingExitDays: days.filter(d => d.status === 'pending_exit').length,
    lateDays: days.filter(d => d.lateMinutes > 0).length, onTimeDays: days.filter(d => d.firstEntry && !d.lateMinutes).length,
    lateMinutes: sum('lateMinutes'), overtimeMinutes: sum('overtimeMinutes'), earlyLeaveMinutes: sum('earlyLeaveMinutes'), workedMinutes: sum('workedMinutes'),
    lunchLateMinutes: sum('lunchLateMinutes'), missingLunchEnds: days.filter(d => d.lunchStatus === 'missing_end').length,
  } };
}
