// Reglas compartidas entre la API (server/) y el frontend (src/).
// Los horarios y los plazos siempre se interpretan en la zona horaria de Lima.
export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const LIMA_TIME_ZONE = 'America/Lima';

// Minutos de tolerancia después del horario de salida antes de considerar la salida "sin marcar".
export const EXIT_GRACE_MINUTES = 5;

export const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const validWeeklySchedule = schedule => !!schedule && typeof schedule === 'object' && !Array.isArray(schedule) && Object.keys(schedule).length === 7 && DAYS.every(day => schedule[day] && validTime(schedule[day].entry) && validTime(schedule[day].exit));
export const shortTime = (value, fallback) => String(value || fallback || '').slice(0, 5);
export const minutesOfTime = value => Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5));
export const timeOfMinutes = minutes => {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
};

export function weeklySchedule(user = {}) {
  if (validWeeklySchedule(user.weekly_schedule)) return user.weekly_schedule;
  return Object.fromEntries(DAYS.map(day => [day, { entry: shortTime(user.scheduled_entry, '08:00'), exit: shortTime(user.scheduled_exit, '17:00') }]));
}
export function scheduleForDate(user, date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: LIMA_TIME_ZONE, weekday: 'long' }).format(new Date(date)).toLowerCase();
  return weeklySchedule(user)[weekday];
}

// Fecha (YYYY-MM-DD) y minutos del día (0–1439) en Lima para un instante dado.
export function limaDay(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LIMA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value));
}
export function limaMinutes(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LIMA_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  return Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
}
export function addDays(day, amount) {
  const [year, month, date] = String(day).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + amount));
  return shifted.toISOString().slice(0, 10);
}
// Instantes UTC que corresponden a una hora local de Lima (UTC-5, sin horario de verano).
export function limaInstant(day, minutes) {
  const [year, month, date] = String(day).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date, 5) + minutes * 60000);
}

// La salida vence a los 5 minutos del horario de salida. Si la jornada cruza la medianoche
// (salida menor que la entrada) el plazo se traslada al día siguiente.
export function exitDeadline(schedule = {}) {
  const entry = minutesOfTime(shortTime(schedule.entry, '08:00'));
  const rawExit = minutesOfTime(shortTime(schedule.exit, '17:00'));
  const overnight = rawExit < entry;
  const deadlineMinutes = (overnight ? rawExit + 1440 : rawExit) + EXIT_GRACE_MINUTES;
  return {
    entry, exit: rawExit, overnight, graceMinutes: EXIT_GRACE_MINUTES, deadlineMinutes,
    lateBy: Math.max(0, deadlineMinutes - 1440),
    scheduledExit: timeOfMinutes(rawExit),
    deadline: timeOfMinutes(deadlineMinutes),
  };
}

// Estado de la salida de una jornada concreta.
// 'missing'  → ya venció el plazo y no hay salida registrada ("sin marcar").
// 'expired'  → la jornada terminó y la salida no se marcó (histórico, definitivo).
// 'recorded' → la salida existe.
// 'pending'  → todavía está dentro del plazo de 5 minutos.
export function exitStatus({ day, entryAt, exitAt = null, schedule = {}, now = new Date() }) {
  if (exitAt) return { status: 'recorded', deadline: null, limitAt: null, lateMark: false, scheduleExit: exitDeadline(schedule).scheduledExit };
  const deadline = exitDeadline(schedule);
  // En jornadas nocturnas el plazo cae al día siguiente (06:00 → 06:05 del día + 1).
  const limitDay = deadline.overnight ? addDays(day, 1) : day;
  const limitMinutes = deadline.overnight ? deadline.lateBy : deadline.deadlineMinutes;
  const limitAt = limaInstant(limitDay, limitMinutes).toISOString();
  const today = limaDay(now);
  const nowMs = new Date(now).getTime();
  const limitMs = new Date(limitAt).getTime();
  // Una entrada marcada con el plazo ya vencido (p. ej. por una regularización) no pierde
  // la posibilidad de cerrar su jornada: su plazo corre desde la propia marcación.
  if (entryAt && new Date(entryAt).getTime() > limitMs) {
    const entryMs = new Date(entryAt).getTime();
    return {
      deadline: deadline.deadline, limitAt, lateMark: true, scheduleExit: deadline.scheduledExit, limitDay,
      status: nowMs > entryMs + EXIT_GRACE_MINUTES * 60000 ? 'missing' : 'pending',
    };
  }
  const base = { deadline: deadline.deadline, limitAt, lateMark: false, scheduleExit: deadline.scheduledExit, limitDay };
  // Días ya cerrados y días con el plazo vencido se tratan igual: la salida quedó sin marcar.
  if (limitDay < today || nowMs > limitMs) return { ...base, status: 'missing' };
  return { ...base, status: 'pending' };
}
