import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { weeklySchedule, validWeeklySchedule, scheduleForDate, exitStatus } from '../server/schedule.js';

test('horarios antiguos se aplican todos los días', () => {
  const user = { scheduled_entry: '08:30:00', scheduled_exit: '17:30:00' };
  assert.deepEqual(scheduleForDate(user, '2026-11-14T16:00:00Z'), { entry: '08:30', exit: '17:30' });
  assert.equal(validWeeklySchedule(weeklySchedule(user)), true);
});
test('selecciona el día en Lima, no en UTC', () => {
  const week = weeklySchedule({});
  week.saturday = { entry: '09:00', exit: '13:00' };
  const user = { weekly_schedule: week };
  assert.deepEqual(scheduleForDate(user, '2026-11-15T02:00:00Z'), week.saturday);
  assert.deepEqual(scheduleForDate(user, '2026-11-15T05:00:00Z'), week.sunday);
});
test('rechaza horarios incompletos o inválidos', () => {
  const week = weeklySchedule({});
  delete week.monday;
  assert.equal(validWeeklySchedule(week), false);
  week.monday = { entry: '25:00', exit: '17:00' };
  assert.equal(validWeeklySchedule(week), false);
});

// Regla del plazo de salida: 5 minutos después del horario de salida.
const schedule = { entry: '08:00', exit: '17:00' };
const at = (iso) => new Date(iso);

test('la salida sigue disponible hasta 17:05', () => {
  const result = exitStatus({ day: '2026-11-12', entryAt: '2026-11-12T13:00:00-05:00', schedule, now: at('2026-11-12T17:05:00-05:00') });
  assert.equal(result.status, 'pending');
  assert.equal(result.deadline, '17:05');
});
test('pasadas las 17:05 sin marcación la salida queda sin marcar', () => {
  const result = exitStatus({ day: '2026-11-12', entryAt: '2026-11-12T13:00:00-05:00', schedule, now: at('2026-11-12T17:05:01-05:00') });
  assert.equal(result.status, 'missing');
  assert.equal(result.deadline, '17:05');
});
test('una salida marcada siempre cuenta como registrada', () => {
  const result = exitStatus({ day: '2026-11-12', entryAt: '2026-11-12T13:00:00-05:00', exitAt: '2026-11-12T18:40:00-05:00', schedule, now: at('2026-11-12T23:00:00-05:00') });
  assert.equal(result.status, 'recorded');
});
test('los días anteriores sin salida también quedan sin marcar', () => {
  const result = exitStatus({ day: '2026-11-11', entryAt: '2026-11-11T13:00:00-05:00', schedule, now: at('2026-11-12T09:00:00-05:00') });
  assert.equal(result.status, 'missing');
  assert.equal(result.deadline, '17:05');
});
test('una entrada marcada después del plazo abre un plazo propio de 5 minutos', () => {
  const open = exitStatus({ day: '2026-11-12', entryAt: '2026-11-12T19:00:00-05:00', schedule, now: at('2026-11-12T19:04:00-05:00') });
  const closed = exitStatus({ day: '2026-11-12', entryAt: '2026-11-12T19:00:00-05:00', schedule, now: at('2026-11-12T19:06:00-05:00') });
  assert.equal(open.status, 'pending');
  assert.equal(open.lateMark, true);
  assert.equal(closed.status, 'missing');
});
test('las jornadas nocturnas vencen al día siguiente', () => {
  const night = { entry: '22:00', exit: '06:00' };
  const before = exitStatus({ day: '2026-11-12', entryAt: '2026-11-12T22:00:00-05:00', schedule: night, now: at('2026-11-13T06:04:00-05:00') });
  const after = exitStatus({ day: '2026-11-12', entryAt: '2026-11-12T22:00:00-05:00', schedule: night, now: at('2026-11-13T06:06:00-05:00') });
  assert.equal(before.status, 'pending');
  assert.equal(before.deadline, '06:05');
  assert.equal(after.status, 'missing');
});
test('el plazo usa la hora de Lima, no UTC', () => {
  // 22:10 UTC = 17:10 en Lima: ya venció aunque en UTC todavía sea "17:10 del mismo día".
  const result = exitStatus({ day: '2026-11-12', entryAt: '2026-11-12T13:00:00-05:00', schedule, now: at('2026-11-12T22:10:00Z') });
  assert.equal(result.status, 'missing');
});
