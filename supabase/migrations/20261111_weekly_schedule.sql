-- Ejecutar en el SQL Editor antes de desplegar la nueva versión.
-- Los usuarios existentes conservan su horario anterior para todos los días.
alter table public.users add column if not exists weekly_schedule jsonb;

create or replace view public.user_attendance_summary as
select
  u.id, u.name, u.username, u.position, u.role, u.active, u.avatar_color,
  u.scheduled_entry, u.scheduled_exit, u.created_at,
  (select a.type from public.attendance a where a.user_id = u.id order by a.id desc limit 1) as last_type,
  (select a.created_at from public.attendance a where a.user_id = u.id order by a.id desc limit 1) as last_attendance,
  (select count(*) from public.attendance a where a.user_id = u.id) as attendance_count,
  u.weekly_schedule
from public.users u;
