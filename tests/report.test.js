import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { reportRange, summarizeReport } from '../server/report.js';
import { createReportWorkbook } from '../server/report-excel.js';

const user = { id: 1, name: 'María Pérez', username: 'maria', position: 'Operaciones', active: true, role: 'employee', scheduled_entry: '08:00', scheduled_exit: '17:00', created_at: '2026-11-01T00:00:00-05:00' };
const mark = (type, time, extra = {}) => ({ user_id: 1, type, created_at: `2026-11-17T${time}:00-05:00`, work_day: '2026-11-17', scheduledEntry: '08:00', scheduledExit: '17:00', ...extra });
const generate = (rows = [], extra = {}) => summarizeReport({ from: '2026-11-17', to: '2026-11-17', now: '2026-11-17T18:00:00-05:00', users: [user], rows, ...extra });

test('rango y mes validan fechas reales, orden y límite', () => {
  assert.deepEqual(reportRange({ month: '2024-02' }), { from: '2024-02-01', to: '2024-02-29' });
  for (const query of [ { from: '2026-02-30', to: '2026-03-01' }, { from: '2026-11-18', to: '2026-11-17' }, { from: '2025-01-01', to: '2026-11-17' }, { month: '2026-13' }, { from: '2026-11-17' } ]) assert.throws(() => reportRange(query), { status: 400 });
});
test('genera sin marcar incluso si no existe ninguna marcación', () => {
  const report = generate();
  assert.equal(report.days[0].status, 'missing_entry');
  assert.equal(report.summary.missingDays, 1);
  assert.equal(report.summary.records, 0);
  assert.equal(report.employees[0].days, 0);
  assert.equal(report.employees[0].missingDays, 1);
});
test('no genera ausencias futuras, antes del alta ni para inactivos o superadmin', () => {
  assert.equal(generate([], { from: '2026-11-18', to: '2026-11-19' }).days.length, 0);
  assert.equal(generate([], { from: '2026-10-29', to: '2026-10-30' }).days.length, 0);
  assert.equal(generate([], { users: [{ ...user, active: false }] }).days.length, 0);
  assert.equal(generate([], { users: [{ ...user, role: 'superadmin' }] }).days.length, 0);
  assert.equal(generate([], { now: '2026-11-17T08:59:59-05:00' }).days[0].status, 'pending');
});
test('descuenta solo el descanso realmente registrado, no extiende hasta 13:40', () => {
  const rows = [mark('entry', '08:00'), mark('lunch_start', '12:40'), mark('lunch_end', '13:00'), mark('exit', '17:00')];
  const report = generate(rows), day = report.days[0];
  assert.equal(day.workedMinutes, 520);
  assert.equal(day.lunchMinutes, 20);
  assert.equal(day.lunchStatus, 'complete');
  assert.equal(day.lunchLateMinutes, 0);
  assert.equal(day.status, 'complete');
  assert.equal(report.summary.records, 4);
});
test('retorno tardío y almuerzo sin fin son incidencias visibles', () => {
  const rows = [mark('entry', '08:00'), mark('lunch_start', '12:00'), mark('exit', '17:00')];
  const report = generate(rows);
  assert.equal(report.days[0].lunchStatus, 'missing_end');
  assert.equal(report.summary.missingLunchEnds, 1);
  assert.equal(report.days[0].workedMinutes, 240);
  rows.push(mark('lunch_end', '13:15'));
  const late = generate(rows);
  assert.equal(late.days[0].lunchLateMinutes, 15);
  assert.equal(late.days[0].lunchStatus, 'late');
  assert.equal(late.days[0].workedMinutes, 465);
});
test('conserva cálculo histórico sin almuerzo y horarios guardados', () => {
  const rows = [mark('entry', '08:30', { late_minutes: 30 }), mark('exit', '17:15', { overtime_minutes: 15 })];
  const report = generate(rows, { users: [{ ...user, active: false, scheduled_entry: '10:00' }] });
  assert.equal(report.days[0].scheduledEntry, '08:00');
  assert.equal(report.days[0].lateMinutes, 30);
  assert.equal(report.days[0].overtimeMinutes, 15);
  assert.equal(report.days[0].workedMinutes, 525);
  assert.equal(report.days.length, 1);
});
test('salida nocturna pertenece al día de ingreso aunque esté fuera del rango calendario', () => {
  const rows = [mark('entry', '22:00'), mark('exit', '06:00', { created_at: '2026-11-18T06:00:00-05:00' })];
  assert.equal(generate(rows).days[0].workedMinutes, 480);
});
test('exporta XLSX real con tres hojas, filtros, paneles y duraciones numéricas', async () => {
  const report = generate([mark('entry', '08:00'), mark('exit', '17:00')]);
  const source = await createReportWorkbook(report, new Date('2026-11-18T00:00:00Z'));
  assert.equal(source.getWorksheet('Detalle diario').getCell('P7').value, 540 / 1440);
  const bytes = await source.xlsx.writeBuffer();
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
  assert.deepEqual(book.worksheets.map(w => w.name), ['Resumen', 'Equipo', 'Detalle diario']);
  const detail = book.getWorksheet('Detalle diario');
  assert.ok(detail.autoFilter);
  assert.equal(detail.views[0].ySplit, 6);
  assert.equal(detail.getCell('P7').value.toISOString(), '1899-12-30T09:00:00.000Z');
  assert.equal(detail.getCell('P7').numFmt, '[h]:mm');
  assert.equal(detail.getCell('Q7').value, 'Completo');
  assert.equal(detail.getCell('G7').value, '08:00');
  assert.equal(detail.getCell('B7').value, 'María Pérez');
  assert.equal(book.getWorksheet('Equipo').getCell('G8').value.toISOString(), '1899-12-30T09:00:00.000Z');
});
test('nombres peligrosos son texto, no fórmulas de Excel; archivo vacío también abre', async () => {
  const report = generate([mark('entry', '08:00')], { users: [{ ...user, name: '=HYPERLINK("https://example.com")' }] });
  const book = await createReportWorkbook(report);
  const data = await book.xlsx.writeBuffer();
  const decoded = new ExcelJS.Workbook(); await decoded.xlsx.load(data);
  assert.equal(decoded.getWorksheet('Detalle diario').getCell('B7').type, ExcelJS.ValueType.String);
  const empty = await createReportWorkbook(generate([], { users: [] }));
  assert.ok((await empty.xlsx.writeBuffer()).length > 0);
});
