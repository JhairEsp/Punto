import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attendanceState, limaDay, validDate } from '../server/attendance-rules.js';
import { weeklySchedule } from '../server/schedule.js';

const user = { scheduled_entry: '08:00', scheduled_exit: '17:00' };
const mark = (type, time, extra = {}) => ({ type, created_at: `2026-11-17T${time}:00-05:00`, work_day: '2026-11-17', scheduled_entry: '08:00', scheduled_exit: '17:00', ...extra });
const state = (records, time) => attendanceState(user, records, `2026-11-17T${time}-05:00`);

test('entrada hasta exactamente una hora; después queda sin marcar', () => {
  assert.ok(state([], '09:00:00').allowedTypes.includes('entry'));
  assert.equal(state([], '09:00:00').missingEntry, false);
  assert.equal(state([], '09:00:01').missingEntry, true);
  assert.ok(!state([], '09:00:01').allowedTypes.includes('entry'));
  assert.equal(state([], '09:00:01').todayCount, 0);
});
test('una sola entrada por jornada, incluso después de la salida', () => {
  assert.ok(!state([mark('entry', '08:00')], '08:01:00').allowedTypes.includes('entry'));
  assert.deepEqual(state([mark('entry', '08:00'), mark('exit', '08:30')], '08:35:00').allowedTypes, []);
});
test('no permite salida ni almuerzo sin entrada', () => {
  assert.deepEqual(state([], '08:01:00').allowedTypes, ['entry']);
  assert.deepEqual(state([], '12:30:00').allowedTypes, []);
});
test('entrada del día anterior no impide comenzar la siguiente jornada', () => {
  const previous = { ...mark('entry', '08:00'), work_day: '2026-11-16', created_at: '2026-11-16T08:00:00-05:00' };
  assert.ok(state([previous], '08:00:00').allowedTypes.includes('entry'));
});
test('el plazo usa el horario semanal del día en Lima', () => {
  const weekly_schedule = weeklySchedule(user);
  weekly_schedule.tuesday = { entry: '10:00', exit: '19:00' };
  assert.ok(attendanceState({ ...user, weekly_schedule }, [], '2026-11-17T10:59:59-05:00').allowedTypes.includes('entry'));
  assert.equal(attendanceState({ ...user, weekly_schedule }, [], '2026-11-17T11:00:01-05:00').missingEntry, true);
});
test('almuerzo solo entre 12 y 13, aunque se inicie tarde termina a las 13', () => {
  const entry = mark('entry', '08:00');
  assert.ok(!state([entry], '11:59:59').allowedTypes.includes('lunch_start'));
  assert.ok(state([entry], '12:00:00').allowedTypes.includes('lunch_start'));
  assert.ok(state([entry], '12:59:59').allowedTypes.includes('lunch_start'));
  assert.ok(!state([entry], '13:00:00').allowedTypes.includes('lunch_start'));
  const marks = [entry, mark('lunch_start', '12:40')];
  assert.ok(!state(marks, '12:59:59').allowedTypes.includes('lunch_end'));
  assert.ok(state(marks, '13:00:00').allowedTypes.includes('lunch_end'));
  assert.equal(state(marks, '13:00:01').lunchStatus, 'overdue');
  assert.ok(state(marks, '14:00:00').allowedTypes.includes('lunch_end'));
  assert.equal(state(marks, '14:00:00').nextType, 'lunch_end');
});
test('no permite repetir inicio ni fin del almuerzo', () => {
  const marks = [mark('entry', '08:00'), mark('lunch_start', '12:00')];
  assert.ok(!state(marks, '12:30:00').allowedTypes.includes('lunch_start'));
  marks.push(mark('lunch_end', '13:00'));
  assert.deepEqual(state(marks, '13:10:00').allowedTypes, ['exit']);
});
test('una jornada nocturna se cierra al día siguiente sin perder el horario original', () => {
  const nightUser = { scheduled_entry: '22:00', scheduled_exit: '06:00' };
  const entry = mark('entry', '22:00', { scheduled_entry: '22:00', scheduled_exit: '06:00' });
  const result = attendanceState(nightUser, [entry], '2026-11-18T06:00:00-05:00');
  assert.equal(result.workDay, '2026-11-17');
  assert.equal(result.scheduledExit, '06:00');
  assert.deepEqual(result.allowedTypes, ['exit']);
});
test('fechas son reales y el cambio de día se hace en Lima', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(limaDay('2026-11-18T02:00:00Z'), '2026-11-17');
});

test('el almuerzo no reinicia ni anula el plazo de cinco minutos para la salida', () => {
  const marks = [mark('entry', '08:00'), mark('lunch_start', '12:00'), mark('lunch_end', '13:00')];
  const before = state(marks, '17:05:00');
  assert.equal(before.openShift, true);
  assert.equal(before.exitDeadline, '17:05');
  assert.ok(before.allowedTypes.includes('exit'));
  const after = state(marks, '17:05:01');
  assert.equal(after.missingExit, true);
  assert.equal(after.openShift, false);
  assert.deepEqual(after.allowedTypes, []);
  assert.match(after.reasons.exit, /5 minutos/);
});
test('salida nocturna vencida no bloquea la entrada de la siguiente jornada', () => {
  const nightUser = { scheduled_entry: '22:00', scheduled_exit: '06:00' };
  const entry = mark('entry', '22:00', { scheduled_entry: '22:00', scheduled_exit: '06:00' });
  const before = attendanceState(nightUser, [entry], '2026-11-18T06:05:00-05:00');
  assert.equal(before.openShift, true);
  assert.ok(before.allowedTypes.includes('exit'));
  const expired = attendanceState(nightUser, [entry], '2026-11-18T06:05:01-05:00');
  assert.equal(expired.openShift, false);
  assert.ok(!expired.allowedTypes.includes('exit'));
  assert.equal(expired.priorExit.day, '2026-11-17');
  assert.equal(attendanceState(nightUser, [entry], '2026-11-18T22:00:00-05:00').allowedTypes.includes('entry'), true);
});
test('horario histórico se conserva y la entrada tardía histórica tiene sus cinco minutos', () => {
  const legacy = mark('entry', '19:00');
  const pending = state([legacy], '19:05:00');
  assert.ok(pending.allowedTypes.includes('exit'));
  assert.equal(pending.exitDeadline, '19:05');
  assert.equal(state([legacy], '19:05:01').missingExit, true);
});
test('descansos entrada igual a salida no generan sin marcar ni permiten entrada', () => {
  const rest = attendanceState({ scheduled_entry: '08:00', scheduled_exit: '08:00' }, [], '2026-11-17T18:00:00-05:00');
  assert.equal(rest.restDay, true);
  assert.equal(rest.missingEntry, false);
  assert.deepEqual(rest.allowedTypes, []);
});
