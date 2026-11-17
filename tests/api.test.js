import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { limaDay, addDays } from '../server/attendance-rules.js';

// Local Supabase REST double: no network credentials and no production writes.
test('API: permisos, filtros inclusivos en Lima, estado y descarga Excel', async () => {
  const today = limaDay(new Date());
  const yesterday = addDays(today, -1);
  const users = [
    { id: 1, name: 'Admin', username: 'admin', role: 'superadmin', active: true, position: 'Admin', scheduled_entry: '08:00', scheduled_exit: '17:00', created_at: `${today}T00:00:00-05:00` },
    { id: 2, name: 'María', username: 'maria', role: 'employee', active: true, position: 'Equipo', scheduled_entry: '08:00', scheduled_exit: '17:00', created_at: `${yesterday}T00:00:00-05:00` },
  ];
  const records = [
    { id: 1, user_id: 2, type: 'entry', work_day: yesterday, created_at: `${yesterday}T13:00:00Z`, photo: 'test.jpg', scheduled_entry: '08:00', scheduled_exit: '17:00', latitude: 0, longitude: 0 },
    { id: 2, user_id: 2, type: 'entry', work_day: today, created_at: `${today}T13:00:00Z`, photo: 'test.jpg', scheduled_entry: '08:00', scheduled_exit: '17:00', latitude: 0, longitude: 0 },
  ];
  const queries = [];
  const fake = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local'); queries.push(url);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.startsWith('/storage/')) { res.end(JSON.stringify([{ path: 'test.jpg', signedURL: '/object/sign/test.jpg?token=fake' }])); return; }
    let data = url.pathname.endsWith('/users') ? [...users] : [...records];
    for (const [column, rule] of url.searchParams) {
      if (!['id', 'active', 'role', 'user_id', 'created_at', 'work_day', 'type'].includes(column)) continue;
      const [op, ...parts] = rule.split('.'), value = parts.join('.');
      data = data.filter(row => {
        const actual = String(row[column]);
        if (op === 'eq') return actual === value;
        if (op === 'in') return value.slice(1, -1).split(',').includes(actual);
        if (column === 'created_at') {
          if (op === 'gte') return new Date(actual) >= new Date(value);
          if (op === 'lt') return new Date(actual) < new Date(value);
        }
        if (op === 'gte') return actual >= value;
        if (op === 'lte') return actual <= value;
        return true;
      });
    }
    if (url.searchParams.get('order')?.includes('desc')) data.reverse();
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  process.env.SUPABASE_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-test-key-not-a-real-credential';
  process.env.JWT_SECRET = 'test-only-secret';
  const { default: app } = await import('../server/app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, id = 1, options = {}) => fetch(`${base}/api${path}`, { ...options, headers: { Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`, ...options.headers } });
  try {
    assert.equal((await fetch(`${base}/api/reports`)).status, 401);
    assert.equal((await request('/reports', 2)).status, 403);
    assert.equal((await request('/reports/export', 2)).status, 403);
    const invalid = await request('/reports?from=2026-02-30&to=2026-03-01');
    assert.equal(invalid.status, 400);
    const response = await request(`/reports?from=${today}&to=${today}&userId=2`);
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.days.length, 1);
    assert.equal(report.days[0].day, today);
    assert.equal(report.summary.records, 1);
    const exported = await request(`/reports/export?from=${today}&to=${today}&userId=2`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /spreadsheetml/);
    assert.match(exported.headers.get('content-disposition'), /\.xlsx/);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
    assert.equal(workbook.worksheets.length, 3);
    const attendance = await request(`/attendance?date=${today}`, 2);
    assert.equal(attendance.status, 200);
    assert.equal((await attendance.json()).length, 1);
    const filterQuery = queries.find(url => url.pathname.endsWith('/attendance') && url.searchParams.has('created_at'));
    assert.ok(filterQuery.searchParams.getAll('created_at').some(value => value.startsWith('gte.')));
    const status = await (await request('/attendance/status', 2)).json();
    assert.ok(!status.allowedTypes.includes('entry'));
    const body = new FormData(); body.set('type', 'entry'); body.set('photo', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg'); body.set('latitude', '-12'); body.set('longitude', '-77');
    const duplicate = await request('/attendance', 2, { method: 'POST', body });
    assert.equal(duplicate.status, 409);
    assert.match((await duplicate.json()).message, /Ya registraste tu entrada/);
  } finally {
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => fake.close(resolve))]);
  }
});
