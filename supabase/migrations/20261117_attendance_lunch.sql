-- Ejecutar ANTES de desplegar la API de esta versión. No borra ni fusiona registros históricos.
begin;
alter table public.attendance drop constraint if exists attendance_type_check;
alter table public.attendance add constraint attendance_type_check check (type in ('entry', 'exit', 'lunch_start', 'lunch_end'));
alter table public.attendance add column if not exists work_day date;
update public.attendance set work_day = (created_at at time zone 'America/Lima')::date where work_day is null;
-- Las salidas nocturnas antiguas pertenecen a la jornada de su entrada previa.
update public.attendance a set work_day = e.work_day
from public.attendance e
where a.type = 'exit' and e.type = 'entry' and e.user_id = a.user_id
  and e.scheduled_exit < e.scheduled_entry and a.created_at > e.created_at
  and a.created_at < e.created_at + interval '24 hours'
  and not exists (select 1 from public.attendance newer where newer.user_id = e.user_id and newer.type = 'entry' and newer.created_at > e.created_at and newer.created_at < a.created_at);
create index if not exists attendance_work_day_idx on public.attendance(work_day, user_id);

-- El bloqueo por usuario evita carreras entre dos pestañas/dispositivos/serverless.
create or replace function public.enforce_attendance_rules() returns trigger
language plpgsql set search_path = public as $$
declare
  person public.users%rowtype;
  entry_mark public.attendance%rowtype;
  local_now timestamp;
  work_date date;
  entry_time time;
  exit_time time;
  weekday text;
  has_exit boolean;
begin
  select * into person from public.users where id = new.user_id for update;
  if not found or not person.active then raise exception 'Tu cuenta no está activa.'; end if;
  -- La hora real del servidor, nunca una fecha enviada por el navegador.
  new.created_at := clock_timestamp();
  local_now := new.created_at at time zone 'America/Lima';
  work_date := local_now::date;
  weekday := lower(trim(to_char(work_date, 'Day')));
  entry_time := coalesce((person.weekly_schedule -> weekday ->> 'entry')::time, person.scheduled_entry);
  exit_time := coalesce((person.weekly_schedule -> weekday ->> 'exit')::time, person.scheduled_exit);
  if new.type <> 'entry' then
    select * into entry_mark from public.attendance
      where user_id = new.user_id and type = 'entry' and work_day in (work_date, work_date - 1)
      order by created_at desc limit 1;
    if found and entry_mark.work_day = work_date - 1 and entry_mark.scheduled_exit < entry_mark.scheduled_entry
      and local_now < work_date + entry_time
      and not exists (select 1 from public.attendance where user_id = new.user_id and work_day = entry_mark.work_day and type = 'exit') then
      work_date := entry_mark.work_day;
    end if;
    select * into entry_mark from public.attendance where user_id = new.user_id and work_day = work_date and type = 'entry' order by created_at limit 1;
    if not found then raise exception 'Primero debes registrar tu entrada.'; end if;
    entry_time := entry_mark.scheduled_entry; exit_time := entry_mark.scheduled_exit;
  end if;
  new.work_day := work_date;
  new.scheduled_entry := entry_time; new.scheduled_exit := exit_time;
  if exists (select 1 from public.attendance where user_id = new.user_id and work_day = work_date and type = new.type) then
    raise exception 'Ya registraste esta marcación en tu jornada.';
  end if;
  select exists (select 1 from public.attendance where user_id = new.user_id and work_day = work_date and type = 'exit') into has_exit;
  if has_exit then raise exception 'Tu jornada ya terminó.'; end if;
  if new.type = 'entry' and local_now > work_date + entry_time + interval '1 hour' then
    raise exception 'Sin marcar: venció el plazo de una hora desde tu ingreso programado.';
  end if;
  if new.type = 'lunch_start' and (local_now < work_date + time '12:00' or local_now >= work_date + time '13:00') then
    raise exception 'El almuerzo solo puede iniciarse entre las 12:00 y las 13:00.';
  end if;
  if new.type = 'lunch_end' then
    if not exists (select 1 from public.attendance where user_id = new.user_id and work_day = work_date and type = 'lunch_start') then
      raise exception 'Primero debes iniciar tu almuerzo.';
    end if;
    if local_now < work_date + time '13:00' then raise exception 'Debes finalizar tu almuerzo a las 13:00.'; end if;
  end if;
  new.late_minutes := 0; new.overtime_minutes := 0; new.early_leave_minutes := 0;
  if new.type = 'entry' then
    new.late_minutes := greatest(0, floor(extract(epoch from (date_trunc('minute', local_now) - (work_date + entry_time))) / 60));
  elsif new.type = 'exit' then
    new.overtime_minutes := greatest(0, floor(extract(epoch from (date_trunc('minute', local_now) - (work_date + exit_time + case when exit_time < entry_time then interval '1 day' else interval '0 day' end))) / 60));
    new.early_leave_minutes := greatest(0, floor(extract(epoch from ((work_date + exit_time + case when exit_time < entry_time then interval '1 day' else interval '0 day' end) - date_trunc('minute', local_now))) / 60));
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_attendance_rules() from public, anon, authenticated;
drop trigger if exists attendance_rules on public.attendance;
create trigger attendance_rules before insert on public.attendance for each row execute function public.enforce_attendance_rules();
commit;
