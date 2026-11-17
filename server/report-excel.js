import ExcelJS from 'exceljs';
import { STATUS_LABELS, LUNCH_LABELS } from './report.js';

const C = { ink: '182C29', green: 'D9F99D', teal: '216957', white: 'FFFFFF', pale: 'F1F6F3', muted: '63766F', red: 'A83C38', pink: 'FDEBE9', amber: 'FFF2D6' };
const time = value => value ? new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '—';
const date = value => value.split('-').reverse().join('/');
const duration = minutes => (Number(minutes) || 0) / 1440;
const DURATION = '[h]:mm';

function sheet(book, name, title, subtitle, columns) {
  const ws = book.addWorksheet(name, { properties: { defaultRowHeight: 24, tabColor: { argb: C.teal } }, views: [{ state: 'frozen', ySplit: 6, xSplit: 2, showGridLines: false }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = columns.map(([header, width, numFmt]) => ({ header, width, style: { font: { name: 'Aptos', size: 11, color: { argb: C.ink } }, ...(numFmt ? { numFmt } : {}) } }));
  ws.mergeCells(1, 1, 1, columns.length); ws.getCell('A1').value = 'PUNTO  /  CONTROL DE ASISTENCIA';
  ws.getRow(1).height = 33; ws.getCell('A1').font = { name: 'Aptos', bold: true, size: 12, color: { argb: C.green } }; ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.ink } };
  ws.mergeCells(2, 1, 2, columns.length); ws.getCell('A2').value = title; ws.getRow(2).height = 39; ws.getCell('A2').font = { name: 'Aptos Display', size: 25, bold: true, color: { argb: C.ink } };
  ws.mergeCells(3, 1, 3, columns.length); ws.getCell('A3').value = subtitle; ws.getCell('A3').font = { name: 'Aptos', size: 11, color: { argb: C.muted } };
  ws.mergeCells(4, 1, 4, columns.length); ws.getCell('A4').value = 'HORAS EN LIMA · Duraciones en h:mm · Almuerzo fijo 12:00–13:00'; ws.getCell('A4').font = { name: 'Aptos', italic: true, size: 10, color: { argb: C.muted } };
  ws.getRow(6).values = columns.map(([header]) => header); ws.getRow(6).height = 32;
  ws.getRow(6).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.teal } }; cell.font = { name: 'Aptos', bold: true, color: { argb: C.white }, size: 10 }; cell.alignment = { vertical: 'middle', wrapText: true }; });
  ws.headerFooter.oddFooter = '&LPunto · Reporte confidencial&RPágina &P de &N';
  ws.pageSetup.printTitlesRow = '1:6';
  return ws;
}
function rows(ws, values, statusColumn = null) {
  for (const value of values) {
    const row = ws.addRow(value); row.height = 28;
    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: row.number % 2 ? C.white : C.pale } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'DCE6DF' } } };
    });
    if (statusColumn) {
      const cell = row.getCell(statusColumn);
      cell.font = { name: 'Aptos', bold: true, size: 10, color: { argb: String(cell.value).startsWith('Sin marcar') ? C.red : C.teal } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: String(cell.value).startsWith('Sin marcar') ? C.pink : cell.value === 'Completo' ? C.green : C.amber } };
    }
  }
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: Math.max(6, ws.rowCount), column: ws.columnCount } };
}
export async function createReportWorkbook(report, now = new Date()) {
  const book = new ExcelJS.Workbook(); book.creator = 'Punto'; book.created = now; book.modified = now;
  book.subject = 'Reporte de asistencia'; book.title = `Punto · ${report.from} a ${report.to}`;
  const subtitle = `${date(report.from)} — ${date(report.to)}  |  Generado: ${new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' }).format(now)}`;
  const summary = sheet(book, 'Resumen', 'El ritmo de tu equipo.', subtitle, [['Indicador', 40], ['Resultado', 30], ['Descripción', 92]]);
  const s = report.summary;
  rows(summary, [
    ['Colaboradores', s.employees, 'Personas incluidas en el periodo seleccionado'],
    ['Jornadas evaluadas', s.days, 'Incluye jornadas sin marcar; no incluye días futuros'],
    ['Marcaciones verificadas', s.records, 'Registros reales con foto y GPS'],
    ['Sin marcar', s.missingDays, 'Sin entrada después de 1 h, o sin salida después de 5 min de tolerancia'],
    ['Entradas puntuales', s.onTimeDays, 'Sin minutos de tardanza'],
    ['Llegadas tarde', s.lateDays, 'Entradas registradas dentro del plazo con tardanza'],
    ['Tiempo trabajado', duration(s.workedMinutes), 'Primera entrada a última salida, menos almuerzo registrado'],
    ['Tardanza acumulada', duration(s.lateMinutes), 'Duración en horas y minutos'],
    ['Tiempo extra', duration(s.overtimeMinutes), 'Según el horario guardado en cada marcación'],
    ['Salidas anticipadas', duration(s.earlyLeaveMinutes), 'Duración en horas y minutos'],
    ['Retorno de almuerzo tardío', duration(s.lunchLateMinutes), 'Minutos después de las 13:00'],
    ['Almuerzos sin finalizar', s.missingLunchEnds, 'Requieren revisión: no se genera una marcación automática'],
    ['Salidas sin marcar', s.missingExitDays, 'La salida se bloquea al vencer los 5 minutos de tolerancia'],
    ['Salidas dentro del plazo', s.pendingExitDays, 'Jornadas abiertas que todavía pueden registrar salida'],
  ]);
  for (const r of [13, 14, 15, 16, 17]) summary.getCell(`B${r}`).numFmt = DURATION;
  summary.mergeCells('A21:C21'); summary.getCell('A21').value = 'Sin finalizar el almuerzo, el tiempo hasta la salida se considera descanso provisional. Revisar incidencias.'; summary.getCell('A21').alignment = { wrapText: true }; summary.getRow(21).height = 34;
  summary.mergeCells('A22:C22'); summary.getCell('A22').value = 'Las ausencias usan el equipo activo y horario actual para días sin registros; no se inventan evidencias ni se modifican marcaciones históricas.'; summary.getCell('A22').alignment = { wrapText: true }; summary.getRow(22).height = 34;
  const team = sheet(book, 'Equipo', 'Resumen por colaborador', subtitle, [['Colaborador', 30], ['Usuario', 20], ['Puesto', 26], ['Días con entrada', 18], ['Sin marcar', 16], ['Días tarde', 15], ['Trabajado', 17, DURATION], ['Tardanza', 17, DURATION], ['Extra', 17, DURATION], ['Salida anticipada', 20, DURATION], ['Retorno almuerzo tarde', 23, DURATION], ['Almuerzos sin fin', 20]]);
  rows(team, report.employees.map(e => [e.name, e.username, e.position, e.days, e.missingDays, e.lateDays, duration(e.workedMinutes), duration(e.lateMinutes), duration(e.overtimeMinutes), duration(e.earlyLeaveMinutes), duration(e.lunchLateMinutes), e.missingLunchEnds]));
  if (report.employees.length) {
    const r = team.addRow(['TOTAL', '', '', ...["days", "missingDays", "lateDays", "workedMinutes", "lateMinutes", "overtimeMinutes", "earlyLeaveMinutes", "lunchLateMinutes", "missingLunchEnds"].map(key => {
      const total = report.employees.reduce((sum, e) => sum + e[key], 0); return key.endsWith('Minutes') ? duration(total) : total;
    })]);
    r.eachCell(cell => { cell.font = { bold: true, color: { argb: C.white } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.teal } }; });
  }
  const detail = sheet(book, 'Detalle diario', 'Cada jornada, con claridad.', subtitle, [['Fecha', 16, 'dd/mm/yyyy'], ['Colaborador', 30], ['Usuario', 20], ['Puesto', 25], ['Ingreso previsto', 18], ['Salida prevista', 18], ['Entrada', 15], ['Salida', 15], ['Inicio almuerzo', 18], ['Fin almuerzo', 18], ['Estado almuerzo', 22], ['Retorno tarde', 18, DURATION], ['Tardanza', 16, DURATION], ['Extra', 16, DURATION], ['Salida anticipada', 20, DURATION], ['Trabajado', 17, DURATION], ['Plazo salida', 18], ['Estado jornada', 23]]);
  rows(detail, report.days.map(d => [new Date(`${d.day}T00:00:00Z`), d.name, d.username, d.position, d.scheduledEntry, d.scheduledExit, time(d.firstEntry), d.lastExit ? time(d.lastExit) : d.status === 'missing_exit' ? 'Sin marcar' : d.status === 'pending_exit' ? 'Dentro del plazo' : '—', time(d.lunchStart), time(d.lunchEnd), LUNCH_LABELS[d.lunchStatus], duration(d.lunchLateMinutes), duration(d.lateMinutes), duration(d.overtimeMinutes), duration(d.earlyLeaveMinutes), duration(d.workedMinutes), d.exitDeadline, STATUS_LABELS[d.status]]), 18);
  return book;
}
