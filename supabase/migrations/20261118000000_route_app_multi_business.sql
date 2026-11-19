-- NV Labs route app (first client: Las Vegas Compost).
-- Multi-business from the start: every row carries business_id, and row-level
-- security only lets signed-in members of that business see or change it.
-- Roles: owner and admin manage everything; driver works their own routes.

create extension if not exists pgcrypto;

-- ---------- businesses and who belongs to them ----------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','driver')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index business_members_user_idx on public.business_members (user_id);

-- An invite turns into a membership the first time that email signs in.
create table public.business_invites (
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('owner','admin','driver')),
  driver_id text,
  created_at timestamptz not null default now(),
  primary key (business_id, email)
);

-- ---------- business data (ids are the app's own short ids, unique per business) ----------
create table public.facilities (
  business_id uuid not null references public.businesses(id) on delete cascade,
  id text not null,
  name text not null,
  short_name text,
  address text,
  city text,
  lat double precision,
  lng double precision,
  primary key (business_id, id)
);

create table public.drivers (
  business_id uuid not null references public.businesses(id) on delete cascade,
  id text not null,
  name text not null,
  phone text,
  color text,
  is_owner boolean not null default false,
  start jsonb not null default '{"kind":"facility"}'::jsonb,
  user_id uuid references auth.users(id) on delete set null,
  sort_order int not null default 0,
  primary key (business_id, id)
);
create index drivers_user_idx on public.drivers (user_id);

create table public.routes (
  business_id uuid not null references public.businesses(id) on delete cascade,
  id text not null,
  name text not null,
  driver_id text,
  status text not null default 'ready' check (status in ('ready','active','done')),
  buckets_loaded boolean not null default false,
  facility_done boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  sort_order int not null default 0,
  primary key (business_id, id),
  foreign key (business_id, driver_id) references public.drivers (business_id, id) on delete set null (driver_id)
);

create table public.customers (
  business_id uuid not null references public.businesses(id) on delete cascade,
  id text not null,
  name text not null,
  phone text,
  address text,
  city text,
  lat double precision,
  lng double precision,
  gate_code text,
  notes text,
  frequency text,
  route_id text,
  created_at timestamptz not null default now(),
  primary key (business_id, id),
  foreign key (business_id, route_id) references public.routes (business_id, id) on delete set null (route_id)
);
create index customers_route_idx on public.customers (business_id, route_id);

create table public.route_stops (
  business_id uuid not null references public.businesses(id) on delete cascade,
  route_id text not null,
  customer_id text not null,
  position int not null default 0,
  stop_type text not null default 'regular' check (stop_type in ('regular','new','final')),
  status text not null default 'pending' check (status in ('pending','done','issue')),
  photo jsonb,
  done_at timestamptz,
  issue text,
  primary key (business_id, route_id, customer_id),
  unique (business_id, customer_id),
  foreign key (business_id, route_id) references public.routes (business_id, id) on delete cascade,
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete cascade
);

-- Log of customer texts and notes to the owner (Twilio sending is separate).
create table public.messages (
  business_id uuid not null references public.businesses(id) on delete cascade,
  id text not null,
  kind text not null,
  customer_id text,
  at timestamptz not null default now(),
  body text,
  photo jsonb,
  recipient_count int,
  primary key (business_id, id)
);
create index messages_at_idx on public.messages (business_id, at desc);

-- Finished routes: mileage log and photo confirmations.
create table public.route_runs (
  business_id uuid not null references public.businesses(id) on delete cascade,
  id text not null,
  kind text not null default 'confirmation' check (kind in ('history','confirmation')),
  route_id text,
  route_name text,
  driver_id text,
  run_date timestamptz not null default now(),
  ended_at timestamptz,
  total int,
  ok int,
  issues int,
  miles numeric(8,1),
  photos jsonb,
  primary key (business_id, id)
);
create index route_runs_date_idx on public.route_runs (business_id, run_date desc);

-- ---------- helper checks used by the policies ----------
create function public.is_member(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_members m
                 where m.business_id = b and m.user_id = (select auth.uid()));
$$;

create function public.is_manager(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_members m
                 where m.business_id = b and m.user_id = (select auth.uid())
                   and m.role in ('owner','admin'));
$$;

create function public.my_driver_id(b uuid) returns text
language sql stable security definer set search_path = '' as $$
  select d.id from public.drivers d
  where d.business_id = b and d.user_id = (select auth.uid())
  limit 1;
$$;

create function public.is_member_folder(p text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.is_member(p::uuid);
exception when others then
  return false;
end;
$$;

-- Called by the app right after sign-in: turns invites for this email into memberships.
create function public.accept_invites() returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  em text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
begin
  if uid is null then return; end if;
  if em <> '' then
    insert into public.business_members (business_id, user_id, role)
      select i.business_id, uid, i.role from public.business_invites i where i.email = em
      on conflict (business_id, user_id) do nothing;
    update public.drivers d set user_id = uid
      from public.business_invites i
      where i.email = em and i.driver_id is not null
        and d.business_id = i.business_id and d.id = i.driver_id;
    delete from public.business_invites where email = em;
  end if;
  return query select m.business_id from public.business_members m where m.user_id = uid;
end;
$$;

revoke all on function public.is_member(uuid), public.is_manager(uuid), public.my_driver_id(uuid),
  public.is_member_folder(text), public.accept_invites() from public, anon;
grant execute on function public.is_member(uuid), public.is_manager(uuid), public.my_driver_id(uuid),
  public.is_member_folder(text), public.accept_invites() to authenticated;

-- ---------- row-level security ----------
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.business_invites enable row level security;
alter table public.facilities enable row level security;
alter table public.drivers enable row level security;
alter table public.routes enable row level security;
alter table public.customers enable row level security;
alter table public.route_stops enable row level security;
alter table public.messages enable row level security;
alter table public.route_runs enable row level security;

-- Nothing is open to signed-out visitors.
revoke all on public.businesses, public.business_members, public.business_invites, public.facilities,
  public.drivers, public.routes, public.customers, public.route_stops, public.messages, public.route_runs from anon;
grant select, insert, update, delete on public.businesses, public.business_members, public.business_invites,
  public.facilities, public.drivers, public.routes, public.customers, public.route_stops, public.messages,
  public.route_runs to authenticated;

create policy "members read" on public.businesses for select to authenticated using (public.is_member(id));
create policy "managers update" on public.businesses for update to authenticated using (public.is_manager(id)) with check (public.is_manager(id));

create policy "read own or managed" on public.business_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_manager(business_id));
create policy "managers add" on public.business_members for insert to authenticated with check (public.is_manager(business_id));
create policy "managers change" on public.business_members for update to authenticated using (public.is_manager(business_id)) with check (public.is_manager(business_id));
create policy "managers remove" on public.business_members for delete to authenticated using (public.is_manager(business_id));

create policy "managers all" on public.business_invites for all to authenticated
  using (public.is_manager(business_id)) with check (public.is_manager(business_id));

-- Owner/admin tables: everyone in the business reads, managers write.
create policy "members read" on public.facilities for select to authenticated using (public.is_member(business_id));
create policy "managers write" on public.facilities for all to authenticated using (public.is_manager(business_id)) with check (public.is_manager(business_id));
create policy "members read" on public.drivers for select to authenticated using (public.is_member(business_id));
create policy "managers write" on public.drivers for all to authenticated using (public.is_manager(business_id)) with check (public.is_manager(business_id));
create policy "members read" on public.customers for select to authenticated using (public.is_member(business_id));
create policy "managers write" on public.customers for all to authenticated using (public.is_manager(business_id)) with check (public.is_manager(business_id));

-- Routes and stops: managers write; a driver can update the routes assigned to them.
create policy "members read" on public.routes for select to authenticated using (public.is_member(business_id));
create policy "managers write" on public.routes for all to authenticated using (public.is_manager(business_id)) with check (public.is_manager(business_id));
create policy "driver updates own route" on public.routes for update to authenticated
  using (driver_id = public.my_driver_id(business_id)) with check (driver_id = public.my_driver_id(business_id));

create policy "members read" on public.route_stops for select to authenticated using (public.is_member(business_id));
create policy "managers write" on public.route_stops for all to authenticated using (public.is_manager(business_id)) with check (public.is_manager(business_id));
create policy "driver updates own stops" on public.route_stops for update to authenticated
  using (exists (select 1 from public.routes r where r.business_id = route_stops.business_id and r.id = route_stops.route_id
                 and r.driver_id = public.my_driver_id(r.business_id)))
  with check (exists (select 1 from public.routes r where r.business_id = route_stops.business_id and r.id = route_stops.route_id
                 and r.driver_id = public.my_driver_id(r.business_id)));

-- Texts and finished-route records: any member can add (drivers log them), managers edit.
create policy "members read" on public.messages for select to authenticated using (public.is_member(business_id));
create policy "members add" on public.messages for insert to authenticated with check (public.is_member(business_id));
create policy "managers change" on public.messages for update to authenticated using (public.is_manager(business_id)) with check (public.is_manager(business_id));
create policy "managers remove" on public.messages for delete to authenticated using (public.is_manager(business_id));
create policy "members read" on public.route_runs for select to authenticated using (public.is_member(business_id));
create policy "members add" on public.route_runs for insert to authenticated with check (public.is_member(business_id));
create policy "managers change" on public.route_runs for update to authenticated using (public.is_manager(business_id)) with check (public.is_manager(business_id));
create policy "managers remove" on public.route_runs for delete to authenticated using (public.is_manager(business_id));

-- ---------- stop photos: private bucket, one folder per business ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stop-photos', 'stop-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "members read stop photos" on storage.objects for select to authenticated
  using (bucket_id = 'stop-photos' and public.is_member_folder((storage.foldername(name))[1]));
create policy "members upload stop photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'stop-photos' and public.is_member_folder((storage.foldername(name))[1]));
create policy "managers remove stop photos" on storage.objects for delete to authenticated
  using (bucket_id = 'stop-photos' and public.is_member_folder((storage.foldername(name))[1])
         and public.is_manager(((storage.foldername(name))[1])::uuid));

-- ---------- live updates so the owner sees driver progress ----------
alter publication supabase_realtime add table public.routes, public.route_stops, public.messages, public.route_runs;
