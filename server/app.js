import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import crypto from 'crypto';
import { shortTime, validTime as validSchedule, validWeeklySchedule, weeklySchedule, scheduleForDate, limaDay, limaMinutes, addDays, exitDeadline, exitStatus } from './schedule.js';
import { getSupabase, supabaseConfigured, unwrap, PHOTO_BUCKET } from './supabase.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'punto-local-secret-change-in-production-2026';
const SESSION_COOKIE = 'punto_session';
const now = () => new Date().toISOString();
const todayLima = () => limaDay(now());
const limaDate = (value) => limaDay(value);
const dayRange = (day) => {
  const [year, month, date] = day.split('-').map(Number);
  return { start: new Date(Date.UTC(year, month - 1, date, 5)).toISOString(), end: new Date(Date.UTC(year, month - 1, date + 1, 5)).toISOString() };
};
const dateRange = (from, to) => ({ start: dayRange(from).start, end: dayRange(to).end });
const publicUser = (u) => ({
  id: u.id, name: u.name, username: u.username, position: u.position, role: u.role,
  active: !!u.active, avatarColor: u.avatar_color, createdAt: u.created_at,
  scheduledEntry: scheduleForDate(u).entry, scheduledExit: scheduleForDate(u).exit, weeklySchedule: weeklySchedule(u),
});
const minutesOfSchedule = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const minutesInLima = (isoDate) => limaMinutes(isoDate);
const calculateScheduleTimes = (type, createdAt, scheduledEntry, scheduledExit) => {
  const actual = minutesInLima(createdAt);
  const entry = minutesOfSchedule(scheduledEntry);
  const exit = minutesOfSchedule(scheduledExit);
  let lateMinutes = 0, overtimeMinutes = 0, earlyLeaveMinutes = 0;
  if (type === 'entry') lateMinutes = Math.max(0, actual - entry);
  if (type === 'exit') {
    const overnight = exit < entry;
    const expectedExit = overnight ? exit + 1440 : exit;
    const actualExit = overnight && actual < entry ? actual + 1440 : actual;
    overtimeMinutes = Math.max(0, actualExit - expectedExit);
    earlyLeaveMinutes = Math.max(0, expectedExit - actualExit);
  }
  return { lateMinutes, overtimeMinutes, earlyLeaveMinutes };
};
const scheduleForAttendance = (user, last, type, date) => {
  const schedule = scheduleForDate(user, date);
  if (type === 'exit' && last?.type === 'entry' && last.scheduled_entry && last.scheduled_exit) {
    const entry = shortTime(last.scheduled_entry), exit = shortTime(last.scheduled_exit);
    const previousDay = new Date(`${limaDate(date)}T12:00:00Z`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    if (exit < entry && limaDate(last.created_at) === previousDay.toISOString().slice(0, 10)) return { entry, exit };
  }
  return schedule;
};
// Mensajes del plazo de salida (5 minutos después del horario de salida).
const LIMIT_MESSAGES = {
  entry: 'Ese día la entrada se marcó después del plazo de salida, así que la salida ya no estaba disponible.',
  exit: 'El plazo de 5 minutos después de tu horario de salida venció: la jornada quedó como "sin marcar".',
};
// Jornada abierta: la última marcación fue una entrada y todavía no tiene salida.
const shiftWindow = (user, last, date = new Date()) => {
  if (!last || last.type !== 'entry') return null;
  const schedule = scheduleForAttendance(user, last, 'exit', date);
  const day = limaDate(last.created_at);
  const rule = exitStatus({ day, entryAt: last.created_at, exitAt: null, schedule, now: date });
  return { schedule, day, rule, closed: rule.status === 'missing' };
};

const cookieOptions = (req) => ({ httpOnly: true, secure: !!req.secure, sameSite: req.secure ? 'none' : 'lax', path: '/' });
const setSessionCookie = (req, res, token) => res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: 30 * 24 * 60 * 60 * 1000 });
const readCookie = (req, name) => {
  for (const item of String(req.headers.cookie || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator > 0 && item.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
};

const auth = async (req, res, next) => {
  try {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const candidates = [req.headers['x-punto-token'], readCookie(req, SESSION_COOKIE), bearer]
      .filter((token, index, list) => typeof token === 'string' && token && list.indexOf(token) === index);
    for (const token of candidates) {
      let payload;
      try { payload = jwt.verify(token, JWT_SECRET); }
      catch { continue; }
      const user = unwrap(await getSupabase().from('users').select('*').eq('id', payload.id).eq('active', true).maybeSingle());
      if (user) { req.user = user; req.sessionToken = token; return next(); }
    }
    res.status(401).json({ message: 'Inicia sesión para continuar.' });
  } catch (error) { next(error); }
};
const adminOnly = (req, res, next) => req.user.role === 'superadmin' ? next() : res.status(403).json({ message: 'Esta acción requiere permisos de SuperAdmin.' });

app.get('/api/health', async (req, res) => {
  if (!supabaseConfigured()) return res.status(503).json({ ok: false, database: 'supabase', configured: false, message: 'Faltan variables de Supabase.' });
  try {
    unwrap(await getSupabase().from('users').select('id').limit(1));
    res.json({ ok: true, database: 'supabase-postgresql', storage: PHOTO_BUCKET, configured: true, time: now() });
  } catch (error) { res.status(503).json({ ok: false, database: 'supabase', configured: true, message: error.message }); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'Ingresa tu usuario y contraseña.' });
    const user = unwrap(await getSupabase().from('users').select('*').eq('username', String(username).trim()).maybeSingle());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ message: 'Usuario o contraseña incorrectos.' });
    if (!user.active) return res.status(403).json({ message: 'Tu cuenta está desactivada. Contacta al administrador.' });
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    setSessionCookie(req, res, token);
    res.json({ token, user: publicUser(user) });
  } catch (error) { next(error); }
});
app.get('/api/auth/me', auth, (req, res) => { setSessionCookie(req, res, req.sessionToken); res.json({ user: publicUser(req.user) }); });
app.post('/api/auth/logout', (req, res) => { res.clearCookie(SESSION_COOKIE, cookieOptions(req)); res.json({ ok: true }); });

app.get('/api/users', auth, adminOnly, async (req, res, next) => {
  try {
    const rows = unwrap(await getSupabase().from('user_attendance_summary').select('*').order('name'));
    rows.sort((a, b) => (a.role === 'superadmin' ? -1 : 0) - (b.role === 'superadmin' ? -1 : 0) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    const reference = new Date();
    res.json(rows.map(u => {
      // La jornada sigue abierta solo si la entrada está dentro del plazo de salida.
      const shift = shiftWindow(u, u.last_type === 'entry' ? { type: 'entry', created_at: u.last_attendance, scheduled_entry: u.scheduled_entry, scheduled_exit: u.scheduled_exit } : null, reference);
      return {
        ...publicUser(u), lastType: u.last_type, lastAttendance: u.last_attendance, attendanceCount: u.attendance_count || 0,
        openShift: !!shift && !shift.closed, shiftClosed: !!shift?.closed,
        shiftDeadline: shift?.rule?.deadline || null,
      };
    }));
  } catch (error) { next(error); }
});
app.post('/api/users', auth, adminOnly, async (req, res, next) => {
  try {
    const { name, username, password, position, scheduledEntry = '08:00', scheduledExit = '17:00', weeklySchedule: requestedSchedule } = req.body || {};
    if (![name, username, password, position].every(value => String(value || '').trim())) return res.status(400).json({ message: 'Completa todos los campos.' });
    if (String(password).length < 6) return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres.' });
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(String(username).trim())) return res.status(400).json({ message: 'El usuario debe tener 3–30 caracteres, sin espacios.' });
    if (!validSchedule(scheduledEntry) || !validSchedule(scheduledExit)) return res.status(400).json({ message: 'Define un horario de entrada y salida válido.' });
    if (requestedSchedule !== undefined && !validWeeklySchedule(requestedSchedule)) return res.status(400).json({ message: 'Define una entrada y salida válida para cada día.' });
    const colors = ['#D9F99D', '#BAE6FD', '#FED7AA', '#DDD6FE', '#FBCFE8', '#A7F3D0'];
    const user = unwrap(await getSupabase().from('users').insert({
      name: String(name).trim(), username: String(username).trim(), password_hash: bcrypt.hashSync(password, 12),
      position: String(position).trim(), role: 'employee', active: true,
      avatar_color: colors[Math.floor(Math.random() * colors.length)], scheduled_entry: scheduledEntry, scheduled_exit: scheduledExit, weekly_schedule: requestedSchedule || null, created_at: now(),
    }).select('*').single());
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'Ese nombre de usuario ya existe.' });
    next(error);
  }
});
app.patch('/api/users/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const current = unwrap(await supabase.from('users').select('*').eq('id', req.params.id).maybeSingle());
    if (!current) return res.status(404).json({ message: 'Usuario no encontrado.' });
    const { name, position, active, password, scheduledEntry = shortTime(current.scheduled_entry), scheduledExit = shortTime(current.scheduled_exit), weeklySchedule: requestedSchedule } = req.body || {};
    if (current.id === req.user.id && active === false) return res.status(400).json({ message: 'No puedes desactivar tu propia cuenta.' });
    if (password && String(password).length < 6) return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres.' });
    if (!validSchedule(scheduledEntry) || !validSchedule(scheduledExit)) return res.status(400).json({ message: 'Define un horario de entrada y salida válido.' });
    if (requestedSchedule !== undefined && !validWeeklySchedule(requestedSchedule)) return res.status(400).json({ message: 'Define una entrada y salida válida para cada día.' });
    const user = unwrap(await supabase.from('users').update({
      name: String(name || current.name).trim(), position: String(position || current.position).trim(),
      active: active === undefined ? current.active : !!active,
      password_hash: password ? bcrypt.hashSync(String(password), 12) : current.password_hash,
      scheduled_entry: scheduledEntry, scheduled_exit: scheduledExit, weekly_schedule: requestedSchedule === undefined ? current.weekly_schedule : requestedSchedule,
    }).eq('id', current.id).select('*').single());
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

app.get('/api/attendance/status', auth, async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const last = unwrap(await supabase.from('attendance').select('*').eq('user_id', req.user.id).order('id', { ascending: false }).limit(1).maybeSingle());
    const range = dayRange(todayLima());
    const countResult = await supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).gte('created_at', range.start).lt('created_at', range.end);
    if (countResult.error) throw countResult.error;
    const reference = now();
    // Si la salida venció sin marcarse, la jornada se cierra como "sin marcar" y la persona
    // puede registrar una nueva entrada (nuevo día) sin quedar bloqueada.
    const shift = shiftWindow(req.user, last, reference);
    const nextType = shift && !shift.closed ? 'exit' : 'entry';
    const schedule = nextType === 'exit' ? shift.schedule : scheduleForDate(req.user, todayLima());
    res.json({
      last: last || null, nextType, todayCount: countResult.count || 0,
      scheduledEntry: schedule.entry, scheduledExit: schedule.exit,
      exitPending: nextType === 'exit' && shift.rule.status === 'pending',
      exitDeadline: nextType === 'exit' ? shift.rule.deadline : null,
      exitDeadlineAt: nextType === 'exit' ? shift.rule.limitAt : null,
      priorExit: shift?.closed ? {
        day: shift.day, deadline: shift.rule.deadline, lateMark: !!shift.rule.lateMark, status: 'missing',
        message: shift.rule.lateMark ? LIMIT_MESSAGES.entry : LIMIT_MESSAGES.exit,
      } : null,
      serverTime: reference,
    });
  } catch (error) { next(error); }
});
app.post('/api/attendance', auth, upload.single('photo'), async (req, res, next) => {
  let photoPath = null;
  try {
    if (!req.file) return res.status(400).json({ message: 'Toma una foto para registrar tu asistencia.' });
    const { type, latitude, longitude, accuracy } = req.body;
    const lat = Number(latitude), lng = Number(longitude);
    if (!['entry', 'exit'].includes(type) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ message: 'Necesitamos una ubicación GPS válida.' });
    const supabase = getSupabase();
    const last = unwrap(await supabase.from('attendance').select('type,created_at,scheduled_entry,scheduled_exit').eq('user_id', req.user.id).order('id', { ascending: false }).limit(1).maybeSingle());
    // Regla del plazo: la salida vence 5 minutos después del horario de salida. Vencido el plazo
    // la jornada queda "sin marcar" y no se acepta la salida (ni sube la foto al almacenamiento).
    const reference = now();
    const shift = shiftWindow(req.user, last, reference);
    if (type === 'exit' && !shift) return res.status(409).json({ message: 'Primero registra tu entrada para poder marcar la salida.' });
    if (shift?.closed && type === 'exit') return res.status(409).json({ message: shift.rule.lateMark ? LIMIT_MESSAGES.entry : LIMIT_MESSAGES.exit, code: 'MARK_WINDOW_CLOSED', exitDeadline: shift.rule.deadline });
    if (last?.type === type && !(type === 'entry' && shift?.closed)) return res.status(409).json({ message: `Tu última marcación ya fue una ${type === 'entry' ? 'entrada' : 'salida'}. Actualiza e inténtalo de nuevo.` });
    const extension = req.file.mimetype === 'image/png' ? '.png' : req.file.mimetype === 'image/webp' ? '.webp' : '.jpg';
    photoPath = `${req.user.id}/${Date.now()}-${crypto.randomUUID()}${extension}`;
    unwrap(await supabase.storage.from(PHOTO_BUCKET).upload(photoPath, req.file.buffer, { contentType: req.file.mimetype, upsert: false }));
    const createdAt = now();
    const { entry: scheduledEntry, exit: scheduledExit } = scheduleForAttendance(req.user, last, type, createdAt);
    const { lateMinutes, overtimeMinutes, earlyLeaveMinutes } = calculateScheduleTimes(type, createdAt, scheduledEntry, scheduledExit);
    const record = unwrap(await supabase.from('attendance').insert({
      user_id: req.user.id, type, photo: photoPath, latitude: lat, longitude: lng, accuracy: Number(accuracy) || null,
      created_at: createdAt, scheduled_entry: scheduledEntry, scheduled_exit: scheduledExit,
      late_minutes: lateMinutes, overtime_minutes: overtimeMinutes, early_leave_minutes: earlyLeaveMinutes,
    }).select('*').single());
    res.status(201).json({ record, message: `${type === 'entry' ? 'Entrada' : 'Salida'} registrada correctamente.` });
  } catch (error) {
    if (photoPath) await getSupabase().storage.from(PHOTO_BUCKET).remove([photoPath]).catch(() => {});
    next(error);
  }
});

async function selectAttendance({ from = null, to = null, start = null, end = null, userId = null, type = null, ascending = false, limit = 500, paginate = false }) {
  const supabase = getSupabase();
  // dayRange()/dateRange() entregan start/end; ambos nombres son válidos.
  const fromValue = from || start, toValue = to || end;
  const build = () => {
    let query = supabase.from('attendance').select('*').order('id', { ascending });
    if (fromValue) query = query.gte('created_at', fromValue);
    if (toValue) query = query.lt('created_at', toValue);
    if (userId) query = query.eq('user_id', userId);
    if (type) query = query.eq('type', type);
    return query;
  };
  if (!paginate) return unwrap(await build().limit(limit));
  const rows = [];
  const pageSize = 1000;
  while (rows.length < limit) {
    const page = unwrap(await build().range(rows.length, rows.length + Math.min(pageSize, limit - rows.length) - 1));
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}
async function withRelations(records, signed = true) {
  if (!records.length) return [];
  const supabase = getSupabase();
  const ids = [...new Set(records.map(record => record.user_id))];
  const users = unwrap(await supabase.from('users').select('id,name,username,position,avatar_color,scheduled_entry,scheduled_exit').in('id', ids));
  const userMap = new Map(users.map(user => [user.id, user]));
  let signedUrls = [];
  if (signed) {
    const result = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(records.map(record => record.photo), 60 * 60 * 2);
    if (result.error) throw result.error;
    signedUrls = result.data || [];
  }
  return records.map((record, index) => {
    const user = userMap.get(record.user_id) || {};
    return {
      ...record, name: user.name, username: user.username, position: user.position, avatarColor: user.avatar_color,
      scheduledEntry: shortTime(record.scheduled_entry || user.scheduled_entry, '08:00'), scheduledExit: shortTime(record.scheduled_exit || user.scheduled_exit, '17:00'),
      lateMinutes: record.late_minutes || 0, overtimeMinutes: record.overtime_minutes || 0, earlyLeaveMinutes: record.early_leave_minutes || 0,
      photoUrl: signed ? signedUrls[index]?.signedUrl || null : null,
    };
  });
}
app.get('/api/attendance', auth, async (req, res, next) => {
  try {
    const { date, userId, type, limit = 200 } = req.query;
    const owner = req.user.role !== 'superadmin' ? req.user.id : (userId && userId !== 'all' ? Number(userId) : null);
    const range = date ? dayRange(String(date)) : {};
    const records = await selectAttendance({ ...range, userId: owner, type: ['entry', 'exit'].includes(type) ? type : null, limit: Math.min(Number(limit) || 200, 500) });
    res.json(await withRelations(records));
  } catch (error) { next(error); }
});
app.get('/api/dashboard', auth, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'superadmin';
    const range = dayRange(todayLima());
    const todayRecords = await selectAttendance({ ...range, userId: isAdmin ? null : req.user.id, limit: 10000, paginate: true });
    const latestByUser = new Map();
    for (const record of todayRecords) if (!latestByUser.has(record.user_id)) latestByUser.set(record.user_id, record);
    // Salidas del día que vencieron su plazo de 5 minutos sin marcación.
    const today = todayLima(), reference = new Date();
    const missingExits = [];
    let team = 1, present = 0;
    if (isAdmin) {
      const members = unwrap(await getSupabase().from('users').select('id,name,position,avatar_color,active,weekly_schedule,scheduled_entry,scheduled_exit').eq('active', true).eq('role', 'employee'));
      const employeeIds = new Set(members.map(member => member.id));
      team = members.length;
      for (const member of members) {
        const entryRecord = todayRecords.find(record => record.user_id === member.id && record.type === 'entry');
        if (!entryRecord) continue;
        const hasExit = todayRecords.some(record => record.user_id === member.id && record.type === 'exit');
        const rule = exitStatus({ day: today, entryAt: entryRecord.created_at, exitAt: null, schedule: scheduleForDate(member, reference), now: reference });
        // "Presente" = jornada abierta y todavía dentro del plazo para marcar salida.
        if (hasExit) continue;
        if (rule.status === 'pending' && employeeIds.has(member.id)) present += 1;
        if (rule.status !== 'missing') continue;
        missingExits.push({
          userId: member.id, name: member.name, position: member.position, avatarColor: member.avatar_color,
          scheduledExit: rule.scheduleExit, exitDeadline: rule.deadline, entryAt: entryRecord.created_at, lateMark: rule.lateMark,
        });
      }
    } else {
      const own = shiftWindow(req.user, latestByUser.get(req.user.id), reference);
      present = own && !own.closed ? 1 : 0;
    }
    const recentRaw = await selectAttendance({ userId: isAdmin ? null : req.user.id, limit: 8 });
    res.json({
      stats: {
        records: todayRecords.length, entries: todayRecords.filter(r => r.type === 'entry').length,
        exits: todayRecords.filter(r => r.type === 'exit').length,
        late_minutes: todayRecords.filter(r => r.type === 'entry').reduce((sum, r) => sum + (r.late_minutes || 0), 0),
        overtime_minutes: todayRecords.filter(r => r.type === 'exit').reduce((sum, r) => sum + (r.overtime_minutes || 0), 0),
        people: new Set(todayRecords.map(r => r.user_id)).size, present, team, missingExits,
      }, recent: await withRelations(recentRaw),
    });
  } catch (error) { next(error); }
});

async function buildReport(query) {
  const month = String(query.month || '');
  let from = String(query.from || ''), to = String(query.to || '');
  const selectedMonth = month || (!from && !to ? todayLima().slice(0, 7) : '');
  if (selectedMonth) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) throw Object.assign(new Error('Selecciona un mes válido.'), { status: 400 });
    const [year, monthNumber] = selectedMonth.split('-').map(Number);
    from = `${selectedMonth}-01`;
    to = `${selectedMonth}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`;
  }
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
  if (!validDate(from) || !validDate(to) || from > to) throw Object.assign(new Error('Selecciona un rango de fechas válido.'), { status: 400 });
  const userId = query.userId && query.userId !== 'all' ? Number(query.userId) : null;
  const range = dateRange(from, to);
  const raw = await selectAttendance({ ...range, userId, ascending: true, limit: 100000, paginate: true });
  const rows = await withRelations(raw, false);
  const grouped = new Map();
  for (const row of rows) {
    const workDay = limaDate(row.created_at), key = `${row.user_id}:${workDay}`;
    if (!grouped.has(key)) grouped.set(key, { userId: row.user_id, name: row.name, username: row.username, position: row.position, avatarColor: row.avatarColor, day: workDay, firstEntry: null, lastExit: null, scheduledEntry: row.scheduledEntry, scheduledExit: row.scheduledExit, records: 0 });
    const group = grouped.get(key);
    group.records += 1;
    if (row.type === 'entry' && !group.firstEntry) group.firstEntry = row;
    if (row.type === 'exit') group.lastExit = row;
  }
  // Reglas del plazo: si pasan 5 minutos del horario de salida sin marcación, la jornada
  // queda "sin marcar". Además, todo colaborador activo con horario que no marcó nada
  // aparece también como "sin marcar" en el rango de fechas consultado.
  const reference = now();
  const today = todayLima();
  // Las ausencias se generan para colaboradores (el SuperAdmin administra y no cumple turnos).
  const members = unwrap(await getSupabase().from('users').select('id,name,username,position,avatar_color,active,created_at,weekly_schedule,scheduled_entry,scheduled_exit').eq('active', true).eq('role', 'employee'));
  const absentMembers = members.filter(member => !userId || member.id === userId);
  const lastDay = to > today ? today : to;
  for (const member of lastDay >= from ? absentMembers : []) {
    // No se generan ausencias anteriores al alta del colaborador.
    const startDay = limaDate(member.created_at) > from ? limaDate(member.created_at) : from;
    for (let day = startDay; day <= lastDay; day = addDays(day, 1)) {
      const schedule = scheduleForDate(member, `${day}T12:00:00Z`);
      // Los días con salida igual a la entrada se consideran días de descanso.
      if (!schedule || shortTime(schedule.entry) === shortTime(schedule.exit)) continue;
      if (grouped.has(`${member.id}:${day}`)) continue;
      const rule = exitStatus({ day, entryAt: null, schedule, now: reference });
      if (rule.status !== 'missing') continue;
      grouped.set(`${member.id}:${day}`, {
        userId: member.id, name: member.name, username: member.username, position: member.position,
        avatarColor: member.avatar_color, day, firstEntry: null, lastExit: null,
        scheduledEntry: shortTime(schedule.entry), scheduledExit: shortTime(schedule.exit), records: 0, absent: true,
      });
    }
  }
  const days = [...grouped.values()].map(group => {
    const schedule = { entry: group.scheduledEntry, exit: group.scheduledExit };
    const rule = exitStatus({ day: group.day, entryAt: group.firstEntry?.created_at, exitAt: group.lastExit?.created_at, schedule, now: reference });
    // 'absent' = no marcó nada ese día; también se muestra como "sin marcar".
    const status = group.firstEntry && group.lastExit ? 'complete' : group.firstEntry ? (rule.status === 'missing' ? 'missing_exit' : 'pending_exit') : group.absent ? 'absent' : 'missing_entry';
    return {
      userId: group.userId, name: group.name, username: group.username, position: group.position, avatarColor: group.avatarColor,
      day: group.day, scheduledEntry: group.scheduledEntry, scheduledExit: group.scheduledExit,
      firstEntry: group.firstEntry?.created_at || null, lastExit: group.lastExit?.created_at || null,
      lateMinutes: group.firstEntry?.late_minutes || 0, overtimeMinutes: group.lastExit?.overtime_minutes || 0,
      earlyLeaveMinutes: group.lastExit?.early_leave_minutes || 0,
      workedMinutes: group.firstEntry && group.lastExit ? Math.max(0, Math.floor((new Date(group.lastExit.created_at) - new Date(group.firstEntry.created_at)) / 60000)) : 0,
      exitDeadline: rule.deadline || exitDeadline(schedule).deadline, exitLateMark: !!rule.lateMark, absent: !!group.absent,
      records: group.records, status,
    };
  }).sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name));
  const employeeMap = new Map();
  for (const day of days) {
    if (!employeeMap.has(day.userId)) employeeMap.set(day.userId, { id: day.userId, name: day.name, username: day.username, position: day.position, avatarColor: day.avatarColor, days: 0, workedDays: 0, missingDays: 0, lateDays: 0, lateMinutes: 0, overtimeMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 0 });
    const employee = employeeMap.get(day.userId);
    employee.days += 1; employee.workedDays += day.status === 'complete' ? 1 : 0; employee.missingDays += day.status === 'missing_exit' || day.status === 'absent' ? 1 : 0;
    employee.lateDays += day.lateMinutes > 0 ? 1 : 0; employee.lateMinutes += day.lateMinutes;
    employee.overtimeMinutes += day.overtimeMinutes; employee.earlyLeaveMinutes += day.earlyLeaveMinutes; employee.workedMinutes += day.workedMinutes;
  }
  const employees = [...employeeMap.values()].sort((a, b) => b.workedMinutes - a.workedMinutes || a.name.localeCompare(b.name));
  return { from, to, days, employees, summary: {
    employees: employees.length, days: days.length, records: rows.length,
    lateDays: days.filter(day => day.lateMinutes > 0).length, onTimeDays: days.filter(day => day.firstEntry && day.lateMinutes === 0).length,
    lateMinutes: days.reduce((sum, day) => sum + day.lateMinutes, 0), overtimeMinutes: days.reduce((sum, day) => sum + day.overtimeMinutes, 0),
    earlyLeaveMinutes: days.reduce((sum, day) => sum + day.earlyLeaveMinutes, 0), workedMinutes: days.reduce((sum, day) => sum + day.workedMinutes, 0),
    missingExitDays: days.filter(day => day.status === 'missing_exit').length, pendingExitDays: days.filter(day => day.status === 'pending_exit').length,
    unmarkedDays: days.filter(day => day.status === 'missing_exit' || day.status === 'absent').length,
  } };
}
app.get('/api/reports', auth, adminOnly, async (req, res, next) => { try { res.json(await buildReport(req.query)); } catch (error) { next(error); } });
app.get('/api/reports/export', auth, adminOnly, async (req, res, next) => {
  try {
    const report = await buildReport(req.query);
    const esc = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const STATUS_LABELS = { complete: 'Completo', missing_exit: 'Sin marcar', absent: 'Sin marcar', pending_exit: 'Dentro del plazo', missing_entry: 'Sin entrada' };
    const localDateTime = (value, day, status) => value
      ? new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
      : status === 'pending_exit' ? 'Dentro del plazo' : 'Sin marcar';
    const lines = [
      ['Fecha', 'Nombre', 'Usuario', 'Puesto', 'Horario entrada', 'Horario salida', 'Plazo máximo de salida', 'Primera entrada', 'Última salida', 'Tardanza (min)', 'Tiempo extra (min)', 'Salida anticipada (min)', 'Tiempo trabajado (min)', 'Estado'].map(esc).join(','),
      ...report.days.map(day => [day.day, day.name, day.username, day.position, day.scheduledEntry, day.scheduledExit, day.exitDeadline, localDateTime(day.firstEntry, day.day, day.status), localDateTime(day.lastExit, day.day, day.status), day.lateMinutes, day.overtimeMinutes, day.earlyLeaveMinutes, day.workedMinutes, STATUS_LABELS[day.status] || 'Sin marcar'].map(esc).join(',')),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-punto-${report.from}-${report.to}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (error) { next(error); }
});
app.get('/api/export', auth, adminOnly, async (req, res, next) => {
  try {
    const rows = await withRelations(await selectAttendance({ limit: 100000, paginate: true }));
    const esc = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = [
      ['ID', 'Nombre', 'Usuario', 'Puesto', 'Tipo', 'Fecha y hora (UTC)', 'Latitud', 'Longitud', 'Precisión GPS (m)', 'Horario entrada', 'Horario salida', 'Tardanza (min)', 'Tiempo extra (min)', 'Salida anticipada (min)', 'Foto'].map(esc).join(','),
      ...rows.map(r => [r.id, r.name, r.username, r.position, r.type === 'entry' ? 'Entrada' : 'Salida', r.created_at, r.latitude, r.longitude, r.accuracy, r.scheduled_entry, r.scheduled_exit, r.late_minutes, r.overtime_minutes, r.early_leave_minutes, r.photoUrl || r.photo].map(esc).join(',')),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="asistencias-punto-${todayLima()}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (error) { next(error); }
});

app.use('/api', (req, res) => res.status(404).json({ message: 'Ruta de API no encontrada.' }));
app.use((error, req, res, next) => {
  console.error(error);
  if (error instanceof multer.MulterError) return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'La foto supera el límite de 4 MB para Vercel.' : 'No se pudo procesar la foto.' });
  res.status(error.status || 500).json({ message: error.status ? error.message : 'Ocurrió un error con Supabase. Revisa la configuración e inténtalo nuevamente.' });
});

export default app;
