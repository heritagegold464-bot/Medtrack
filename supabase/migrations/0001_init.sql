-- MEDTRACK schema. Every table is owner-scoped with row-level security.
-- Design rules:
--   * No DELETE policy exists: records are soft-deleted (deleted_at), so history is never erased.
--   * `version` is incremented by the server on every update. Clients send the version they last saw
--     and the update only applies if it still matches (optimistic concurrency -> conflict detection).
--   * `updated_at` is server-authoritative; `client_updated_at` preserves the device timestamp.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- helpers
create or replace function public.medtrack_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.updated_at := now();
  else
    -- Ownership and identity can never change.
    new.id := old.id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;

-- Macro-ish helper: common columns are repeated per table for clarity.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key,                               -- equals auth.users.id
  user_id uuid not null references auth.users(id) on delete cascade unique,
  display_name text not null default '',
  timezone text not null default 'Africa/Lagos',
  primary_time text not null default '09:00',
  primary_minutes int not null default 180 check (primary_minutes between 1 and 720),
  secondary_time text not null default '16:00',
  secondary_minutes int not null default 120 check (secondary_minutes between 1 and 720),
  accountability_time text not null default '18:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz
);

-- ---------------------------------------------------------------- courses
create table public.courses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  title text not null,
  units int not null check (units between 0 and 20),
  department text not null default '',
  position int not null default 0,
  included boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  unique (user_id, code)
);

-- ---------------------------------------------------------------- syllabus_topics
create table public.syllabus_topics (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  parent_id uuid references public.syllabus_topics(id),
  title text not null check (char_length(title) between 1 and 500),
  is_official boolean not null default false,        -- true = from the uploaded outline
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed')),
  notes text not null default '',
  page_ref text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz
);
create index on public.syllabus_topics (user_id, course_id);

-- ---------------------------------------------------------------- cycle_templates (editable timetable)
create table public.cycle_templates (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  day_number int not null check (day_number >= 1),
  primary_course_id uuid not null references public.courses(id),
  secondary_course_id uuid not null references public.courses(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  unique (user_id, day_number)
);

-- ---------------------------------------------------------------- cycle_days (actual instances)
create table public.cycle_days (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_number int not null check (cycle_number >= 1),
  day_number int not null check (day_number >= 1),
  opened_on date not null,                           -- Lagos calendar date when opened (informational only)
  status text not null default 'open' check (status in ('open','closed')),
  close_reason text check (close_reason in ('completed','reviewed')),
  closed_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  unique (user_id, cycle_number, day_number)
);

-- ---------------------------------------------------------------- reading_sessions
create table public.reading_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_day_id uuid not null references public.cycle_days(id),
  slot text not null check (slot in ('primary','secondary')),
  course_id uuid not null references public.courses(id),
  planned_start text not null,                       -- 'HH:MM' Africa/Lagos
  planned_minutes int not null check (planned_minutes > 0),
  status text not null default 'pending'
    check (status in ('pending','in_progress','completed','partial','missed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  unique (user_id, cycle_day_id, slot)
);

-- ---------------------------------------------------------------- study_records (actuals)
create table public.study_records (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.reading_sessions(id),
  actual_seconds int not null default 0 check (actual_seconds >= 0),
  study_date date not null,                          -- Lagos date the study happened
  timer_running_since timestamptz,                   -- non-null while the timer runs
  timer_accumulated_seconds int not null default 0 check (timer_accumulated_seconds >= 0),
  pages text not null default '',
  slides text not null default '',
  reflection text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  unique (user_id, session_id)
);

-- ---------------------------------------------------------------- session_topic_logs
-- Topic title/course are snapshotted so history survives topic edits or deletion.
create table public.session_topic_logs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.reading_sessions(id),
  topic_id uuid not null references public.syllabus_topics(id),
  topic_title text not null,
  course_id uuid not null references public.courses(id),
  status_after text not null check (status_after in ('not_started','in_progress','completed')),
  confidence int check (confidence between 1 and 5),
  minutes int not null default 0 check (minutes >= 0),
  pages text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  unique (user_id, session_id, topic_id)
);

-- ---------------------------------------------------------------- daily_accountability
create table public.daily_accountability (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  check_date date not null,
  followed_plan text not null check (followed_plan in ('yes','partly','no')),
  biggest_obstacle text not null default '',
  tomorrow_commitment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  unique (user_id, check_date)
);

-- ---------------------------------------------------------------- notification_preferences
create table public.notification_preferences (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade unique,
  primary_reminder boolean not null default true,
  secondary_reminder boolean not null default true,
  accountability_reminder boolean not null default true,
  overdue_reminder boolean not null default true,
  overdue_after_minutes int not null default 30 check (overdue_after_minutes between 5 and 240),
  incomplete_reminder boolean not null default true,
  unrecorded_reminder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz
);

-- ---------------------------------------------------------------- sync_metadata (per device)
create table public.sync_metadata (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_label text not null default '',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  unique (user_id, device_id)
);

-- ---------------------------------------------------------------- push_subscriptions
-- Written only by the signed-in user; read by the reminder Edge Function with the service role.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

-- ---------------------------------------------------------------- triggers + RLS
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','courses','syllabus_topics','cycle_templates','cycle_days','reading_sessions',
    'study_records','session_topic_logs','daily_accountability','notification_preferences','sync_metadata'
  ] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.medtrack_touch()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (user_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (user_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    -- Intentionally NO delete policy: history is preserved; deletions are soft (deleted_at).
  end loop;
end $$;

alter table public.push_subscriptions enable row level security;
create policy push_select on public.push_subscriptions for select using (user_id = auth.uid());
create policy push_insert on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy push_delete on public.push_subscriptions for delete using (user_id = auth.uid());

-- Cross-table ownership guard: a row may only reference parents owned by the same user.
create or replace function public.medtrack_same_owner() returns trigger
language plpgsql as $$
declare ok boolean;
begin
  if tg_table_name = 'syllabus_topics' then
    select exists(select 1 from public.courses c where c.id = new.course_id and c.user_id = new.user_id) into ok;
  elsif tg_table_name = 'reading_sessions' then
    select exists(select 1 from public.cycle_days d where d.id = new.cycle_day_id and d.user_id = new.user_id)
       and exists(select 1 from public.courses c where c.id = new.course_id and c.user_id = new.user_id) into ok;
  elsif tg_table_name = 'study_records' then
    select exists(select 1 from public.reading_sessions s where s.id = new.session_id and s.user_id = new.user_id) into ok;
  elsif tg_table_name = 'session_topic_logs' then
    select exists(select 1 from public.reading_sessions s where s.id = new.session_id and s.user_id = new.user_id)
       and exists(select 1 from public.syllabus_topics t where t.id = new.topic_id and t.user_id = new.user_id) into ok;
  elsif tg_table_name = 'cycle_templates' then
    select exists(select 1 from public.courses c where c.id = new.primary_course_id and c.user_id = new.user_id)
       and exists(select 1 from public.courses c where c.id = new.secondary_course_id and c.user_id = new.user_id) into ok;
  else
    ok := true;
  end if;
  if not ok then raise exception 'referenced record belongs to another user' using errcode = '42501'; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['syllabus_topics','reading_sessions','study_records','session_topic_logs','cycle_templates'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.medtrack_same_owner()', t || '_owner', t);
  end loop;
end $$;
