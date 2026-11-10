import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, 'punto.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    position TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee' CHECK(role IN ('superadmin','employee')),
    active INTEGER NOT NULL DEFAULT 1,
    avatar_color TEXT NOT NULL DEFAULT '#D9F99D',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('entry','exit')),
    photo TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy REAL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(created_at);
`);

// Migraciones no destructivas para instalaciones existentes.
const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
const userColumns = columns('users');
if (!userColumns.includes('scheduled_entry')) db.exec(`ALTER TABLE users ADD COLUMN scheduled_entry TEXT NOT NULL DEFAULT '08:00'`);
if (!userColumns.includes('scheduled_exit')) db.exec(`ALTER TABLE users ADD COLUMN scheduled_exit TEXT NOT NULL DEFAULT '17:00'`);
const attendanceColumns = columns('attendance');
if (!attendanceColumns.includes('scheduled_entry')) db.exec(`ALTER TABLE attendance ADD COLUMN scheduled_entry TEXT`);
if (!attendanceColumns.includes('scheduled_exit')) db.exec(`ALTER TABLE attendance ADD COLUMN scheduled_exit TEXT`);
if (!attendanceColumns.includes('late_minutes')) db.exec(`ALTER TABLE attendance ADD COLUMN late_minutes INTEGER NOT NULL DEFAULT 0`);
if (!attendanceColumns.includes('overtime_minutes')) db.exec(`ALTER TABLE attendance ADD COLUMN overtime_minutes INTEGER NOT NULL DEFAULT 0`);
if (!attendanceColumns.includes('early_leave_minutes')) db.exec(`ALTER TABLE attendance ADD COLUMN early_leave_minutes INTEGER NOT NULL DEFAULT 0`);

const now = () => new Date().toISOString();
const todayLima = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const publicUser = (u) => ({
  id: u.id, name: u.name, username: u.username, position: u.position, role: u.role,
  active: !!u.active, avatarColor: u.avatar_color, createdAt: u.created_at,
  scheduledEntry: u.scheduled_entry || '08:00', scheduledExit: u.scheduled_exit || '17:00',
});
const validSchedule = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
const minutesOfSchedule = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const minutesInLima = (isoDate) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(isoDate));
  const hour = Number(parts.find(part => part.type === 'hour').value);
  const minute = Number(parts.find(part => part.type === 'minute').value);
  return hour * 60 + minute;
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

if (!db.prepare('SELECT id FROM users WHERE username = ?').get('Velcco')) {
  db.prepare(`INSERT INTO users (name, username, password_hash, position, role, avatar_color, created_at)
    VALUES (?, ?, ?, ?, 'superadmin', ?, ?)`)
    .run('Velcco', 'Velcco', bcrypt.hashSync('Velcco2026@', 12), 'SuperAdmin', '#C9F27C', now());
}

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadDir, { maxAge: '1d' }));
const JWT_SECRET = process.env.JWT_SECRET || 'punto-local-secret-change-in-production-2026';
const SESSION_COOKIE = 'punto_session';
const cookieOptions = (req) => ({
  httpOnly: true,
  secure: !!req.secure,
  sameSite: req.secure ? 'none' : 'lax',
  path: '/',
});
const setSessionCookie = (req, res, token) => res.cookie(SESSION_COOKIE, token, {
  ...cookieOptions(req), maxAge: 30 * 24 * 60 * 60 * 1000,
});
const readCookie = (req, name) => {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const item of cookies) {
    const separator = item.indexOf('=');
    if (separator > 0 && item.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
};

const auth = (req, res, next) => {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const candidates = [req.headers['x-punto-token'], readCookie(req, SESSION_COOKIE), bearer]
    .filter((token, index, list) => typeof token === 'string' && token && list.indexOf(token) === index);
  for (const token of candidates) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.id);
      if (user) {
        req.user = user;
        req.sessionToken = token;
        return next();
      }
    } catch { /* Probamos el siguiente mecanismo de sesión disponible. */ }
  }
  res.status(401).json({ message: 'Inicia sesión para continuar.' });
};
const adminOnly = (req, res, next) => req.user.role === 'superadmin'
  ? next() : res.status(403).json({ message: 'Esta acción requiere permisos de SuperAdmin.' });

app.get('/api/health', (_, res) => res.json({ ok: true, database: 'sqlite', time: now() }));

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ message: 'Ingresa tu usuario y contraseña.' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: 'Usuario o contraseña incorrectos.' });
  }
  if (!user.active) return res.status(403).json({ message: 'Tu cuenta está desactivada. Contacta al administrador.' });
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  setSessionCookie(req, res, token);
  res.json({ token, user: publicUser(user) });
});

app.get('/api/auth/me', auth, (req, res) => {
  setSessionCookie(req, res, req.sessionToken);
  res.json({ user: publicUser(req.user) });
});
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
  res.json({ ok: true });
});

app.get('/api/users', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT u.*,
      (SELECT type FROM attendance a WHERE a.user_id = u.id ORDER BY a.id DESC LIMIT 1) AS last_type,
      (SELECT created_at FROM attendance a WHERE a.user_id = u.id ORDER BY a.id DESC LIMIT 1) AS last_attendance,
      (SELECT COUNT(*) FROM attendance a WHERE a.user_id = u.id) AS attendance_count
    FROM users u ORDER BY u.role = 'superadmin' DESC, u.active DESC, u.name ASC
  `).all();
  res.json(rows.map(u => ({ ...publicUser(u), lastType: u.last_type, lastAttendance: u.last_attendance, attendanceCount: u.attendance_count })));
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { name, username, password, position, scheduledEntry = '08:00', scheduledExit = '17:00' } = req.body || {};
  if (![name, username, password, position].every(v => String(v || '').trim())) {
    return res.status(400).json({ message: 'Completa todos los campos.' });
  }
  if (String(password).length < 6) return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres.' });
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(String(username).trim())) {
    return res.status(400).json({ message: 'El usuario debe tener 3–30 caracteres, sin espacios.' });
  }
  if (!validSchedule(scheduledEntry) || !validSchedule(scheduledExit)) {
    return res.status(400).json({ message: 'Define un horario de entrada y salida válido.' });
  }
  const colors = ['#D9F99D', '#BAE6FD', '#FED7AA', '#DDD6FE', '#FBCFE8', '#A7F3D0'];
  try {
    const result = db.prepare(`INSERT INTO users (name, username, password_hash, position, role, avatar_color, scheduled_entry, scheduled_exit, created_at)
      VALUES (?, ?, ?, ?, 'employee', ?, ?, ?, ?)`)
      .run(String(name).trim(), String(username).trim(), bcrypt.hashSync(password, 12), String(position).trim(), colors[Math.floor(Math.random() * colors.length)], scheduledEntry, scheduledExit, now());
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.message.includes('UNIQUE')) return res.status(409).json({ message: 'Ese nombre de usuario ya existe.' });
    throw error;
  }
});

app.patch('/api/users/:id', auth, adminOnly, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });
  const { name, position, active, password, scheduledEntry = user.scheduled_entry, scheduledExit = user.scheduled_exit } = req.body || {};
  if (user.id === req.user.id && active === false) return res.status(400).json({ message: 'No puedes desactivar tu propia cuenta.' });
  if (password && String(password).length < 6) return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres.' });
  if (!validSchedule(scheduledEntry) || !validSchedule(scheduledExit)) return res.status(400).json({ message: 'Define un horario de entrada y salida válido.' });
  db.prepare(`UPDATE users SET name = ?, position = ?, active = ?, password_hash = ?, scheduled_entry = ?, scheduled_exit = ? WHERE id = ?`).run(
    String(name || user.name).trim(), String(position || user.position).trim(),
    active === undefined ? user.active : (active ? 1 : 0),
    password ? bcrypt.hashSync(String(password), 12) : user.password_hash,
    scheduledEntry, scheduledExit, user.id,
  );
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

app.get('/api/attendance/status', auth, (req, res) => {
  const last = db.prepare('SELECT * FROM attendance WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  const today = todayLima();
  const count = db.prepare(`SELECT COUNT(*) AS count FROM attendance WHERE user_id = ? AND date(created_at, '-5 hours') = ?`).get(req.user.id, today).count;
  res.json({
    last: last || null, nextType: last?.type === 'entry' ? 'exit' : 'entry', todayCount: count,
    scheduledEntry: req.user.scheduled_entry, scheduledExit: req.user.scheduled_exit,
  });
});

app.post('/api/attendance', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Toma una foto para registrar tu asistencia.' });
  const { type, latitude, longitude, accuracy } = req.body;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!['entry', 'exit'].includes(type) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ message: 'Necesitamos una ubicación GPS válida.' });
  }
  const last = db.prepare('SELECT type FROM attendance WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  if (last?.type === type) {
    fs.unlinkSync(req.file.path);
    return res.status(409).json({ message: `Tu última marcación ya fue una ${type === 'entry' ? 'entrada' : 'salida'}. Actualiza e inténtalo de nuevo.` });
  }
  const createdAt = now();
  const scheduledEntry = req.user.scheduled_entry || '08:00';
  const scheduledExit = req.user.scheduled_exit || '17:00';
  const { lateMinutes, overtimeMinutes, earlyLeaveMinutes } = calculateScheduleTimes(type, createdAt, scheduledEntry, scheduledExit);
  const result = db.prepare(`INSERT INTO attendance (
    user_id, type, photo, latitude, longitude, accuracy, created_at,
    scheduled_entry, scheduled_exit, late_minutes, overtime_minutes, early_leave_minutes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      req.user.id, type, req.file.filename, lat, lng, Number(accuracy) || null, createdAt,
      scheduledEntry, scheduledExit, lateMinutes, overtimeMinutes, earlyLeaveMinutes,
    );
  const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ record, message: `${type === 'entry' ? 'Entrada' : 'Salida'} registrada correctamente.` });
});

const attendanceQuery = `
  SELECT a.*, u.name, u.username, u.position, u.avatar_color,
    u.scheduled_entry AS user_scheduled_entry, u.scheduled_exit AS user_scheduled_exit
  FROM attendance a JOIN users u ON u.id = a.user_id
`;
const mapRecord = (r) => ({
  ...r,
  photoUrl: `/uploads/${r.photo}`,
  avatarColor: r.avatar_color,
  lateMinutes: r.late_minutes || 0,
  overtimeMinutes: r.overtime_minutes || 0,
  earlyLeaveMinutes: r.early_leave_minutes || 0,
  scheduledEntry: r.scheduled_entry || r.user_scheduled_entry || '08:00',
  scheduledExit: r.scheduled_exit || r.user_scheduled_exit || '17:00',
});

app.get('/api/attendance', auth, (req, res) => {
  const { date, userId, type, limit = 200 } = req.query;
  const where = [];
  const params = [];
  if (req.user.role !== 'superadmin') {
    where.push('a.user_id = ?'); params.push(req.user.id);
  } else if (userId && userId !== 'all') {
    where.push('a.user_id = ?'); params.push(Number(userId));
  }
  if (date) { where.push(`date(a.created_at, '-5 hours') = ?`); params.push(String(date)); }
  if (['entry', 'exit'].includes(type)) { where.push('a.type = ?'); params.push(type); }
  const sql = `${attendanceQuery} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT ?`;
  params.push(Math.min(Number(limit) || 200, 500));
  res.json(db.prepare(sql).all(...params).map(mapRecord));
});

app.get('/api/dashboard', auth, (req, res) => {
  const today = todayLima();
  const isAdmin = req.user.role === 'superadmin';
  const userFilter = isAdmin ? '' : 'AND a.user_id = ?';
  const params = isAdmin ? [today] : [today, req.user.id];
  const stats = db.prepare(`SELECT
    COUNT(*) AS records,
    SUM(CASE WHEN a.type = 'entry' THEN 1 ELSE 0 END) AS entries,
    SUM(CASE WHEN a.type = 'exit' THEN 1 ELSE 0 END) AS exits,
    COALESCE(SUM(CASE WHEN a.type = 'entry' THEN a.late_minutes ELSE 0 END), 0) AS late_minutes,
    COALESCE(SUM(CASE WHEN a.type = 'exit' THEN a.overtime_minutes ELSE 0 END), 0) AS overtime_minutes,
    COUNT(DISTINCT a.user_id) AS people
    FROM attendance a WHERE date(a.created_at, '-5 hours') = ? ${userFilter}`).get(...params);
  let present = 0;
  let team = 1;
  if (isAdmin) {
    team = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE active = 1 AND role = 'employee'`).get().count;
    present = db.prepare(`SELECT COUNT(*) AS count FROM users u WHERE u.active = 1 AND u.role = 'employee' AND
      (SELECT type FROM attendance a WHERE a.user_id = u.id ORDER BY a.id DESC LIMIT 1) = 'entry' AND
      date((SELECT created_at FROM attendance a WHERE a.user_id = u.id ORDER BY a.id DESC LIMIT 1), '-5 hours') = ?`).get(today).count;
  } else {
    const last = db.prepare(`SELECT type, created_at FROM attendance WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(req.user.id);
    present = last?.type === 'entry' && db.prepare(`SELECT date(?, '-5 hours') AS day`).get(last.created_at).day === today ? 1 : 0;
  }
  const recentWhere = isAdmin ? '' : 'WHERE a.user_id = ?';
  const recent = db.prepare(`${attendanceQuery} ${recentWhere} ORDER BY a.id DESC LIMIT 8`)
    .all(...(isAdmin ? [] : [req.user.id])).map(mapRecord);
  res.json({ stats: { ...stats, present, team }, recent });
});

const buildReport = (query) => {
  const month = String(query.month || '');
  let from = String(query.from || '');
  let to = String(query.to || '');
  const selectedMonth = month || (!from && !to ? todayLima().slice(0, 7) : '');
  if (selectedMonth) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) throw Object.assign(new Error('Selecciona un mes válido.'), { status: 400 });
    const [year, monthNumber] = selectedMonth.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    from = `${selectedMonth}-01`;
    to = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
  }
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
  if (!validDate(from) || !validDate(to) || from > to) {
    throw Object.assign(new Error('Selecciona un rango de fechas válido.'), { status: 400 });
  }
  const params = [from, to];
  let userFilter = '';
  if (query.userId && query.userId !== 'all') {
    const userId = Number(query.userId);
    if (!Number.isInteger(userId) || userId < 1) throw Object.assign(new Error('El colaborador seleccionado no es válido.'), { status: 400 });
    userFilter = 'AND a.user_id = ?';
    params.push(userId);
  }
  const rows = db.prepare(`
    SELECT a.*, u.name, u.username, u.position, u.avatar_color,
      u.scheduled_entry AS user_scheduled_entry, u.scheduled_exit AS user_scheduled_exit,
      date(a.created_at, '-5 hours') AS work_day
    FROM attendance a JOIN users u ON u.id = a.user_id
    WHERE date(a.created_at, '-5 hours') BETWEEN ? AND ? ${userFilter}
    ORDER BY a.created_at ASC, a.id ASC
  `).all(...params);

  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.user_id}:${row.work_day}`;
    if (!grouped.has(key)) grouped.set(key, {
      userId: row.user_id, name: row.name, username: row.username, position: row.position,
      avatarColor: row.avatar_color, day: row.work_day, firstEntry: null, lastExit: null,
      scheduledEntry: row.scheduled_entry || row.user_scheduled_entry,
      scheduledExit: row.scheduled_exit || row.user_scheduled_exit, records: 0,
    });
    const group = grouped.get(key);
    group.records += 1;
    if (row.type === 'entry' && !group.firstEntry) group.firstEntry = row;
    if (row.type === 'exit') group.lastExit = row;
  }
  const days = [...grouped.values()].map(group => {
    const workedMinutes = group.firstEntry && group.lastExit
      ? Math.max(0, Math.floor((new Date(group.lastExit.created_at) - new Date(group.firstEntry.created_at)) / 60000)) : 0;
    return {
      userId: group.userId, name: group.name, username: group.username, position: group.position,
      avatarColor: group.avatarColor, day: group.day, scheduledEntry: group.scheduledEntry, scheduledExit: group.scheduledExit,
      firstEntry: group.firstEntry?.created_at || null, lastExit: group.lastExit?.created_at || null,
      lateMinutes: group.firstEntry?.late_minutes || 0,
      overtimeMinutes: group.lastExit?.overtime_minutes || 0,
      earlyLeaveMinutes: group.lastExit?.early_leave_minutes || 0,
      workedMinutes, records: group.records,
      status: group.firstEntry && group.lastExit ? 'complete' : group.firstEntry ? 'missing_exit' : 'missing_entry',
    };
  }).sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name));

  const employeeMap = new Map();
  for (const day of days) {
    if (!employeeMap.has(day.userId)) employeeMap.set(day.userId, {
      id: day.userId, name: day.name, username: day.username, position: day.position, avatarColor: day.avatarColor,
      days: 0, lateDays: 0, lateMinutes: 0, overtimeMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 0,
    });
    const employee = employeeMap.get(day.userId);
    employee.days += 1;
    employee.lateDays += day.lateMinutes > 0 ? 1 : 0;
    employee.lateMinutes += day.lateMinutes;
    employee.overtimeMinutes += day.overtimeMinutes;
    employee.earlyLeaveMinutes += day.earlyLeaveMinutes;
    employee.workedMinutes += day.workedMinutes;
  }
  const employees = [...employeeMap.values()].sort((a, b) => b.workedMinutes - a.workedMinutes || a.name.localeCompare(b.name));
  const summary = {
    employees: employees.length,
    days: days.length,
    records: rows.length,
    lateDays: days.filter(day => day.lateMinutes > 0).length,
    onTimeDays: days.filter(day => day.firstEntry && day.lateMinutes === 0).length,
    lateMinutes: days.reduce((sum, day) => sum + day.lateMinutes, 0),
    overtimeMinutes: days.reduce((sum, day) => sum + day.overtimeMinutes, 0),
    earlyLeaveMinutes: days.reduce((sum, day) => sum + day.earlyLeaveMinutes, 0),
    workedMinutes: days.reduce((sum, day) => sum + day.workedMinutes, 0),
  };
  return { from, to, days, employees, summary };
};

app.get('/api/reports', auth, adminOnly, (req, res) => {
  try { res.json(buildReport(req.query)); }
  catch (error) { res.status(error.status || 500).json({ message: error.message || 'No se pudo generar el reporte.' }); }
});
app.get('/api/reports/export', auth, adminOnly, (req, res) => {
  try {
    const report = buildReport(req.query);
    const esc = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const localDateTime = (value) => value ? new Intl.DateTimeFormat('es-PE', {
      timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(value)) : 'Pendiente';
    const lines = [
      ['Fecha', 'Nombre', 'Usuario', 'Puesto', 'Horario entrada', 'Horario salida', 'Primera entrada', 'Última salida', 'Tardanza (min)', 'Tiempo extra (min)', 'Salida anticipada (min)', 'Tiempo trabajado (min)', 'Estado'].map(esc).join(','),
      ...report.days.map(day => [
        day.day, day.name, day.username, day.position, day.scheduledEntry, day.scheduledExit,
        localDateTime(day.firstEntry), localDateTime(day.lastExit), day.lateMinutes, day.overtimeMinutes,
        day.earlyLeaveMinutes, day.workedMinutes,
        day.status === 'complete' ? 'Completo' : day.status === 'missing_exit' ? 'Sin salida' : 'Sin entrada',
      ].map(esc).join(',')),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-punto-${report.from}-${report.to}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (error) { res.status(error.status || 500).json({ message: error.message || 'No se pudo exportar el reporte.' }); }
});

app.get('/api/export', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`${attendanceQuery} ORDER BY a.id DESC`).all();
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = '\uFEFF' + [
    ['ID', 'Nombre', 'Usuario', 'Puesto', 'Tipo', 'Fecha y hora (UTC)', 'Latitud', 'Longitud', 'Precisión GPS (m)', 'Horario entrada', 'Horario salida', 'Tardanza (min)', 'Tiempo extra (min)', 'Salida anticipada (min)', 'Foto'].map(esc).join(','),
    ...rows.map(r => [r.id, r.name, r.username, r.position, r.type === 'entry' ? 'Entrada' : 'Salida', r.created_at, r.latitude, r.longitude, r.accuracy, r.scheduled_entry, r.scheduled_exit, r.late_minutes, r.overtime_minutes, r.early_leave_minutes, `/uploads/${r.photo}`].map(esc).join(',')),
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="asistencias-punto-${todayLima()}.csv"`);
  res.send(csv);
});

const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(distDir, 'index.html')));
}

app.use((error, req, res, next) => {
  console.error(error);
  if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  if (error instanceof multer.MulterError) return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'La foto supera el límite de 8 MB.' : 'No se pudo procesar la foto.' });
  res.status(500).json({ message: 'Ocurrió un error inesperado. Inténtalo nuevamente.' });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, '0.0.0.0', () => console.log(`Punto API + SQLite listos en http://0.0.0.0:${port}`));
