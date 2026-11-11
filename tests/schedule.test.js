import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { weeklySchedule, validWeeklySchedule, scheduleForDate } from '../server/schedule.js';

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
