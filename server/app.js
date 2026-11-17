import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import crypto from 'crypto';
import { attendanceState, MARK_TYPES, MARK_LABELS, addDays } from './attendance-rules.js';
import { reportRange, summarizeReport } from './report.js';
import { createReportWorkbook } from './report-excel.js';
import { shortTime, validTime as validSchedule, validWeeklySchedule, weeklySchedule, scheduleForDate } from './schedule.js';
import { getSupabase, supabaseConfigured, unwrap, PHOTO_BUCKET } from './supabase.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'punto-local-secret-change-in-production-2026';
const SESSION_COOKIE = 'punto_session';
const now = () => new Date().toISOString();
const todayLima = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const dayRange = (day) => {
  const [year, month, date] = day.split('-').map(Number);
  return { from: new Date(Date.UTC(year, month - 1, date, 5)).toISOString(), to: new Date(Date.UTC(year, month - 1, date + 1, 5)).toISOString() };
};

const publicUser = (u) => ({
  id: u.id, name: u.name, username: u.username, position: u.position, role: u.role,
  active: !!u.active, avatarColor: u.avatar_color, createdAt: u.created_at,
  scheduledEntry: scheduleForDate(u).entry, scheduledExit: scheduleForDate(u).exit, weeklySchedule: weeklySchedule(u),
});
const minutesOfSchedule = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const minutesInLima = (isoDate) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(isoDate));
  return Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
};
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
    res.json(rows.map(u => ({ ...publicUser(u), lastType: u.last_type, lastAttendance: u.last_attendance, attendanceCount: u.attendance_count || 0 })));
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

async function currentAttendanceState(user) {
  const records = await selectAttendance({ from: dayRange(addDays(todayLima(), -1)).from, userId: user.id, ascending: true, limit: 10000, paginate: true });
  return attendanceState(user, records);
}
app.get('/api/attendance/status', auth, async (req, res, next) => {
  try { res.json(await currentAttendanceState(req.user)); } catch (error) { next(error); }
});
app.post('/api/attendance', auth, upload.single('photo'), async (req, res, next) => {
  let photoPath = null;
  try {
    if (!req.file) return res.status(400).json({ message: 'Toma una foto para registrar tu asistencia.' });
    const { type, latitude, longitude, accuracy } = req.body;
    const lat = Number(latitude), lng = Number(longitude);
    if (!MARK_TYPES.includes(type) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ message: 'Necesitamos una ubicación GPS válida.' });
    const supabase = getSupabase();
    const state = await currentAttendanceState(req.user);
    if (!state.allowedTypes.includes(type)) return res.status(409).json({ message: state.reasons[type] });
    const extension = req.file.mimetype === 'image/png' ? '.png' : req.file.mimetype === 'image/webp' ? '.webp' : '.jpg';
    photoPath = `${req.user.id}/${Date.now()}-${crypto.randomUUID()}${extension}`;
    unwrap(await supabase.storage.from(PHOTO_BUCKET).upload(photoPath, req.file.buffer, { contentType: req.file.mimetype, upsert: false }));
    const createdAt = now();
    const { scheduledEntry, scheduledExit } = state;
    const { lateMinutes, overtimeMinutes, earlyLeaveMinutes } = calculateScheduleTimes(type, createdAt, scheduledEntry, scheduledExit);
    const record = unwrap(await supabase.from('attendance').insert({
      user_id: req.user.id, type, work_day: state.workDay, photo: photoPath, latitude: lat, longitude: lng, accuracy: Number(accuracy) || null,
      created_at: createdAt, scheduled_entry: scheduledEntry, scheduled_exit: scheduledExit,
      late_minutes: lateMinutes, overtime_minutes: overtimeMinutes, early_leave_minutes: earlyLeaveMinutes,
    }).select('*').single());
    res.status(201).json({ record, message: `${MARK_LABELS[type]} registrada correctamente.` });
  } catch (error) {
    if (photoPath) await getSupabase().storage.from(PHOTO_BUCKET).remove([photoPath]).catch(() => {});
    if (['23505', 'P0001'].includes(error.code)) return res.status(409).json({ message: error.message });
    next(error);
  }
});

async function selectAttendance({ workFrom = null, workTo = null, from = null, to = null, userId = null, type = null, ascending = false, limit = 500, paginate = false }) {
  const supabase = getSupabase();
  const build = () => {
    let query = supabase.from('attendance').select('*').order('id', { ascending });
    if (workFrom) query = query.gte('work_day', workFrom);
    if (workTo) query = query.lte('work_day', workTo);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lt('created_at', to);
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
    const records = await selectAttendance({ ...range, userId: owner, type: MARK_TYPES.includes(type) ? type : null, limit: Math.min(Number(limit) || 200, 500) });
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
    let team = 1, present = 0, missing = 0;
    if (isAdmin) {
      const employees = unwrap(await getSupabase().from('users').select('*').eq('active', true).eq('role', 'employee'));
      const employeeIds = new Set(employees.map(employee => employee.id));
      team = employees.length;
      missing = employees.filter(employee => attendanceState(employee, todayRecords.filter(r => r.user_id === employee.id)).missingEntry).length;
      present = [...latestByUser.values()].filter(record => record.type !== 'exit' && employeeIds.has(record.user_id)).length;
    } else present = latestByUser.has(req.user.id) && latestByUser.get(req.user.id).type !== 'exit' ? 1 : 0;
    const recentRaw = await selectAttendance({ userId: isAdmin ? null : req.user.id, limit: 8 });
    res.json({
      attendanceStatus: await currentAttendanceState(req.user),
      stats: {
        records: todayRecords.length, entries: todayRecords.filter(r => r.type === 'entry').length,
        exits: todayRecords.filter(r => r.type === 'exit').length,
        late_minutes: todayRecords.filter(r => r.type === 'entry').reduce((sum, r) => sum + (r.late_minutes || 0), 0),
        overtime_minutes: todayRecords.filter(r => r.type === 'exit').reduce((sum, r) => sum + (r.overtime_minutes || 0), 0),
        people: new Set(todayRecords.map(r => r.user_id)).size, present, team, missing,
      }, recent: await withRelations(recentRaw),
    });
  } catch (error) { next(error); }
});

async function buildReport(query) {
  const { from, to } = reportRange(query);
  const userId = query.userId && query.userId !== 'all' ? Number(query.userId) : null;
  if (userId !== null && (!Number.isSafeInteger(userId) || userId <= 0)) throw Object.assign(new Error('Selecciona un colaborador válido.'), { status: 400 });
  let userQuery = getSupabase().from('users').select('*').order('id');
  if (userId) userQuery = userQuery.eq('id', userId);
  const users = [];
  for (let offset = 0; ; offset += 1000) {
    const page = unwrap(await userQuery.range(offset, offset + 999));
    users.push(...page);
    if (page.length < 1000) break;
  }
  const raw = await selectAttendance({ workFrom: from, workTo: to, userId, ascending: true, limit: 100000, paginate: true });
  if (raw.length >= 100000) throw Object.assign(new Error('El periodo contiene demasiadas marcaciones. Selecciona un rango menor.'), { status: 400 });
  const rows = await withRelations(raw, false);
  return summarizeReport({ from, to, rows, users });
}
app.get('/api/reports', auth, adminOnly, async (req, res, next) => { try { res.json(await buildReport(req.query)); } catch (error) { next(error); } });
app.get('/api/reports/export', auth, adminOnly, async (req, res, next) => {
  try {
    const report = await buildReport(req.query);
    const workbook = await createReportWorkbook(report);
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-punto-${report.from}-${report.to}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) { next(error); }
});
app.get('/api/export', auth, adminOnly, async (req, res, next) => {
  try {
    const rows = await withRelations(await selectAttendance({ limit: 100000, paginate: true }));
    const esc = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = [
      ['ID', 'Nombre', 'Usuario', 'Puesto', 'Tipo', 'Fecha y hora (UTC)', 'Latitud', 'Longitud', 'Precisión GPS (m)', 'Horario entrada', 'Horario salida', 'Tardanza (min)', 'Tiempo extra (min)', 'Salida anticipada (min)', 'Foto'].map(esc).join(','),
      ...rows.map(r => [r.id, r.name, r.username, r.position, MARK_LABELS[r.type] || r.type, r.created_at, r.latitude, r.longitude, r.accuracy, r.scheduled_entry, r.scheduled_exit, r.late_minutes, r.overtime_minutes, r.early_leave_minutes, r.photoUrl || r.photo].map(esc).join(',')),
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
