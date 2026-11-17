// Compatibilidad: la API importa las reglas desde aquí y el frontend desde ../shared.
export {
  DAYS, LIMA_TIME_ZONE, EXIT_GRACE_MINUTES, validTime, validWeeklySchedule, shortTime,
  minutesOfTime, timeOfMinutes, weeklySchedule, scheduleForDate, limaDay, limaMinutes,
  addDays, limaInstant, exitDeadline, exitStatus,
} from '../shared/schedule.js';
