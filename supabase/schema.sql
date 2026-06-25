-- ===========================================================================
-- Hoppity HR — database schema, run once in the Supabase SQL editor.
-- Tables, row-level security, the signup trigger (domain lock + profile
-- bootstrap), and seed holidays. Designed for Supabase (Postgres + auth).
-- ===========================================================================

-- ---- tables --------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text unique not null,
  name        text not null default '',
  role        text not null default '',
  dept        text not null default 'Founders'' Office',
  join_date   date not null default current_date,
  schedule    text not null default 'standard' check (schedule in ('standard','sales-ops')),
  active       boolean not null default true,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Admins can pre-fill someone's details before their first Google login.
-- The signup trigger merges a matching invite into the new profile.
create table if not exists public.pending_invites (
  email     text primary key,
  name      text,
  role      text,
  dept      text,
  join_date date,
  schedule  text
);

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  date        date not null,
  clock_in    timestamptz,
  clock_out   timestamptz,
  work_mode   text check (work_mode in ('office','coworking','home','travelling')),
  unique (employee_id, date)
);

create table if not exists public.leave_requests (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in ('PL','SL','CL')),
  start_date  date not null,
  end_date    date not null,
  days        integer not null,
  reason      text,
  emergency   boolean not null default false,
  doc_cert    boolean not null default false,
  warnings    jsonb default '[]'::jsonb,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  applied_on  date not null default current_date,
  decided_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table if not exists public.holidays (
  date date primary key,
  name text not null
);

-- Activity signals pulled by the sync job (Google Workspace, GitHub, ...).
create table if not exists public.activity_signals (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  date        date not null,
  source      text not null,           -- 'drive' | 'gmail' | 'calendar' | 'login' | 'github'
  metric      text not null,           -- e.g. 'edits', 'sends', 'events', 'commits'
  value       text not null,           -- human-readable summary, e.g. '12 edits'
  raw         jsonb,
  synced_at   timestamptz not null default now(),
  unique (employee_id, date, source, metric)
);

-- The third leg of credibility: what each person planned to ship that day.
create table if not exists public.daily_plan (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  date        date not null,
  title       text not null,
  status      text not null default 'planned' check (status in ('planned','done')),
  created_at  timestamptz not null default now()
);

-- ---- admin helper (SECURITY DEFINER avoids recursive RLS on profiles) -----

create or replace function public.is_admin()
returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---- signup trigger: domain lock + profile bootstrap ----------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if new.email not like '%@triffair.com' then
    raise exception 'Access limited to @triffair.com accounts';
  end if;

  select * into inv from public.pending_invites where email = new.email;

  insert into public.profiles (id, email, name, role, dept, join_date, schedule, is_admin)
  values (
    new.id,
    new.email,
    coalesce(inv.name, new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(inv.role, ''),
    coalesce(inv.dept, 'Founders'' Office'),
    coalesce(inv.join_date, current_date),
    coalesce(inv.schedule, 'standard'),
    (new.email = 'sabyasachi@triffair.com')   -- bootstrap the first admin
  );

  delete from public.pending_invites where email = new.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- row level security ---------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.pending_invites enable row level security;
alter table public.attendance      enable row level security;
alter table public.leave_requests  enable row level security;
alter table public.holidays        enable row level security;
alter table public.activity_signals enable row level security;
alter table public.daily_plan      enable row level security;

-- profiles: roster visible to all signed-in users; edit own or admin edits all.
create policy "profiles_select" on public.profiles for select to authenticated using (true);
create policy "profiles_update" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- pending_invites: admin only.
create policy "invites_all" on public.pending_invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- attendance: see/record your own; admins see and adjust everyone.
create policy "att_select" on public.attendance for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());
create policy "att_insert" on public.attendance for insert to authenticated
  with check (employee_id = auth.uid() or public.is_admin());
create policy "att_update" on public.attendance for update to authenticated
  using (employee_id = auth.uid() or public.is_admin()) with check (employee_id = auth.uid() or public.is_admin());
create policy "att_delete" on public.attendance for delete to authenticated
  using (public.is_admin());

-- leave: apply for yourself; only admins decide. Owner or admin can delete.
create policy "lv_select" on public.leave_requests for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());
create policy "lv_insert" on public.leave_requests for insert to authenticated
  with check (employee_id = auth.uid() or public.is_admin());
create policy "lv_update" on public.leave_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "lv_delete" on public.leave_requests for delete to authenticated
  using (employee_id = auth.uid() or public.is_admin());

-- holidays: everyone reads; admins write.
create policy "hol_select" on public.holidays for select to authenticated using (true);
create policy "hol_write"  on public.holidays for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- activity_signals: read your own (admins all). Writes happen only via the
-- edge function using the service-role key, which bypasses RLS.
create policy "sig_select" on public.activity_signals for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

-- daily_plan: own or admin.
create policy "plan_all" on public.daily_plan for all to authenticated
  using (employee_id = auth.uid() or public.is_admin()) with check (employee_id = auth.uid() or public.is_admin());

-- ---- seed holidays (fixed national + Gandhi Jayanti; add festivals in app) -

insert into public.holidays (date, name) values
  ('2025-08-15','Independence Day'),
  ('2025-10-02','Gandhi Jayanti'),
  ('2026-01-26','Republic Day'),
  ('2026-08-15','Independence Day')
on conflict (date) do nothing;
