import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/20261117_attendance_lunch.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

test('esquema nuevo incluye exactamente las mismas reglas que la migración', () => {
  assert.ok(schema.endsWith(migration));
});
test('migración PostgreSQL preserva historia y protege inserciones en base de datos', async () => {
  const db = new PGlite();
  try {
    const tables = schema.slice(schema.indexOf('create table if not exists public.users'), schema.indexOf('create index if not exists attendance_user_id_id_idx')).replace('username citext', 'username text');
    await db.exec('create role anon; create role authenticated;' + tables);
    await db.exec(`insert into users (name,username,password_hash,position) values ('Histórico','old','test','Test');
      insert into attendance (user_id,type,photo,latitude,longitude,created_at,scheduled_entry,scheduled_exit) values
      (1,'entry','test',0,0,'2026-11-15T22:00:00-05:00','22:00','06:00'),
      (1,'exit','test',0,0,'2026-11-16T06:00:00-05:00','22:00','06:00'),
      (1,'entry','test',0,0,'2026-11-15T22:01:00-05:00','22:00','06:00');`);
    await db.exec(migration);
    // Existing duplicate rows are preserved; rerunning migration is safe.
    await db.exec(migration);
    assert.equal((await db.query('select count(*)::int as n from attendance')).rows[0].n, 3);
    assert.equal((await db.query("select work_day::text from attendance where type = 'exit'")).rows[0].work_day, '2026-11-15');
    await db.exec(`insert into users (name,username,password_hash,position,scheduled_entry,scheduled_exit)
      values ('Prueba','test','test','Test',(clock_timestamp() at time zone 'America/Lima')::time,'23:59');`);
    const insert = (type, id = 2) => db.query(`insert into attendance (user_id,type,photo,latitude,longitude,created_at) values ($1,$2,'test',0,0,'2000-01-01') returning *, work_day::text as day`, [id, type]);
    await assert.rejects(insert('exit'), /Primero debes registrar tu entrada/);
    await assert.rejects(insert('lunch_end'), /Primero debes registrar tu entrada/);
    const entry = (await insert('entry')).rows[0];
    assert.notEqual(entry.day, '2000-01-01');
    const duplicates = await Promise.allSettled([insert('entry'), insert('entry')]);
    assert.ok(duplicates.every(result => result.status === 'rejected'));
    assert.match(duplicates[0].reason.message, /Ya registraste/);
    await assert.rejects(insert('lunch_end'), /Primero debes iniciar tu almuerzo/);
    const hour = (await db.query("select extract(hour from clock_timestamp() at time zone 'America/Lima')::int as h")).rows[0].h;
    if (hour === 12) {
      await insert('lunch_start');
      await assert.rejects(insert('lunch_start'), /Ya registraste/);
      await assert.rejects(insert('lunch_end'), /13:00/);
    } else {
      await assert.rejects(insert('lunch_start'), /12:00 y las 13:00/);
    }
    await insert('exit');
    await assert.rejects(insert('exit'), /Ya registraste/);
    await assert.rejects(insert('entry'), /Ya registraste/);
    await db.exec("update users set active = false where id = 2");
    await assert.rejects(insert('entry'), /no está activa/);
  } finally { await db.close(); }
});
