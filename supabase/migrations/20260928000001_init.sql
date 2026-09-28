-- =============================================================================
-- Warranty / AMC Renewal Reminder SaaS — initial schema
--
-- Multi-tenant model: every business row carries tenant_id and is protected by
-- Row Level Security. A signed-in user only sees rows where
-- tenant_id = current_tenant_id(); super_admin sees everything.
-- The service role (server-side cron / webhooks) bypasses RLS by design.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.subscription_plan   as enum ('trial', 'basic', 'pro', 'enterprise');
create type public.subscription_status as enum ('active', 'expired', 'cancelled');
create type public.user_role           as enum ('owner', 'staff', 'super_admin');
create type public.reminder_type       as enum ('warranty', 'amc');
create type public.reminder_status     as enum ('pending', 'sent', 'failed', 'cancelled');
create type public.notify_channel      as enum ('sms', 'email', 'whatsapp');
create type public.payment_status      as enum ('pending', 'active', 'failed', 'cancelled', 'expired');

-- -----------------------------------------------------------------------------
-- Auth helper functions (plpgsql so they can be declared before public.users).
-- SECURITY DEFINER so they can read public.users without recursing into RLS.
-- -----------------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
begin
  return (select u.tenant_id from public.users u where u.id = auth.uid());
end;
$$;

create or replace function public.current_app_role()
returns public.user_role
language plpgsql stable security definer
set search_path = ''
as $$
begin
  return (select u.role from public.users u where u.id = auth.uid());
end;
$$;

create or replace function public.is_super_admin()
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  return coalesce((select u.role = 'super_admin' from public.users u where u.id = auth.uid()), false);
end;
$$;

-- True when the statement runs as the service role / a DB superuser
-- (cron jobs, webhooks, migrations) rather than as an end user.
create or replace function public.is_trusted_backend()
returns boolean
language plpgsql stable
set search_path = ''
as $$
begin
  return coalesce(auth.role(), '') = 'service_role'
      or current_user in ('postgres', 'supabase_admin', 'service_role');
end;
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.tenants (
  id                    uuid primary key default gen_random_uuid(),
  business_name         text not null check (length(trim(business_name)) between 1 and 200),
  business_type         text,
  phone                 text,
  address               text,
  subscription_plan     public.subscription_plan   not null default 'trial',
  subscription_status   public.subscription_status not null default 'active',
  trial_ends_at         timestamptz not null default (now() + interval '14 days'),
  subscription_ends_at  timestamptz,
  -- Reminder preferences
  reminder_days         int[]   not null default '{30,15,7,1}'
                        check (array_length(reminder_days, 1) between 1 and 10 and 0 < all (reminder_days)),
  notify_owner_sms      boolean not null default false,
  notify_owner_email    boolean not null default true,
  created_at            timestamptz not null default now()
);

-- One row per auth user (id = auth.users.id).
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  tenant_id   uuid references public.tenants (id) on delete cascade,
  email       text,
  phone       text,
  role        public.user_role not null default 'owner',
  name        text,
  created_at  timestamptz not null default now(),
  last_login  timestamptz,
  constraint users_tenant_required check (role = 'super_admin' or tenant_id is not null)
);
create index users_tenant_idx on public.users (tenant_id);

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 200),
  phone       text,
  email       text,
  address     text,
  created_at  timestamptz not null default now(),
  -- lets products reference (customer_id, tenant_id) so a product can never
  -- point at another tenant's customer
  unique (id, tenant_id)
);
create unique index customers_tenant_phone_uniq on public.customers (tenant_id, phone) where phone is not null;
create index customers_tenant_name_idx on public.customers (tenant_id, name);

create table public.products (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
  customer_id           uuid not null,
  product_name          text not null check (length(trim(product_name)) between 1 and 200),
  category              text,
  serial_number         text,
  purchase_date         date not null,
  warranty_months       int  not null default 0 check (warranty_months between 0 and 600),
  -- Expiry dates are derived, never typed in by hand, so they can't drift.
  warranty_expiry_date  date generated always as (
                          case when warranty_months > 0
                               then (purchase_date + make_interval(months => warranty_months))::date
                          end) stored,
  amc_start_date        date,
  amc_months            int check (amc_months is null or amc_months between 1 and 600),
  amc_expiry_date       date generated always as (
                          case when amc_start_date is not null and amc_months is not null
                               then (amc_start_date + make_interval(months => amc_months))::date
                          end) stored,
  is_active             boolean not null default true,
  -- unguessable token for the customer-facing public warranty page
  public_token          uuid not null default gen_random_uuid() unique,
  notes                 text,
  created_at            timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (customer_id, tenant_id) references public.customers (id, tenant_id) on delete cascade
);
create index products_tenant_warranty_idx on public.products (tenant_id, warranty_expiry_date) where is_active;
create index products_tenant_amc_idx      on public.products (tenant_id, amc_expiry_date)      where is_active;
create index products_customer_idx        on public.products (customer_id);

create table public.reminders (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  product_id       uuid not null,
  reminder_type    public.reminder_type not null,
  days_before      int not null check (days_before > 0),
  -- the expiry date this reminder was generated for; if the product's expiry
  -- is later edited (e.g. AMC renewed) the old reminder is cancelled at send time
  expiry_date      date not null,
  scheduled_date   date not null,
  status           public.reminder_status not null default 'pending',
  channel          public.notify_channel  not null default 'sms',
  attempts         int  not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  foreign key (product_id, tenant_id) references public.products (id, tenant_id) on delete cascade,
  -- de-duplication: one reminder per product/type/expiry/window/channel
  unique (product_id, reminder_type, expiry_date, days_before, channel)
);
create index reminders_queue_idx  on public.reminders (next_attempt_at) where status = 'pending';
create index reminders_tenant_idx on public.reminders (tenant_id, created_at desc);

create table public.notification_logs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid references public.tenants (id) on delete cascade,
  reminder_id        uuid references public.reminders (id) on delete set null,
  kind               text not null default 'reminder',   -- reminder | platform_renewal | test
  channel            public.notify_channel not null default 'sms',
  recipient_phone    text,
  recipient_email    text,
  message_content    text not null,
  status             text not null check (status in ('sent', 'failed')),
  provider_response  text,
  sms_segments       int not null default 0,
  cost               numeric(10, 4) not null default 0,  -- provider cost to the platform (BDT)
  sent_at            timestamptz not null default now()
);
create index notification_logs_tenant_idx on public.notification_logs (tenant_id, sent_at desc);
create index notification_logs_sent_idx   on public.notification_logs (sent_at desc);

create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants (id) on delete cascade,
  plan                    public.subscription_plan not null,
  amount                  numeric(12, 2) not null check (amount >= 0),
  billing_cycle           text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly')),
  starts_at               timestamptz,
  ends_at                 timestamptz,
  payment_ref             text unique,          -- bKash paymentID
  provider_trx_id         text,                 -- bKash trxID
  status                  public.payment_status not null default 'pending',
  renewal_notice_sent_at  timestamptz,
  created_at              timestamptz not null default now()
);
create index subscriptions_tenant_idx on public.subscriptions (tenant_id, created_at desc);

create table public.sms_credits (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null unique references public.tenants (id) on delete cascade,
  balance        int not null default 0 check (balance >= 0),
  last_topup_at  timestamptz
);

-- Platform-level job bookkeeping for the super admin "system health" view.
create table public.cron_runs (
  id           uuid primary key default gen_random_uuid(),
  job          text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'ok', 'error')),
  details      jsonb
);
create index cron_runs_job_idx on public.cron_runs (job, started_at desc);

-- -----------------------------------------------------------------------------
-- Plan limits (keep in sync with src/lib/plans.ts)
-- -----------------------------------------------------------------------------
create or replace function public.plan_product_limit(p public.subscription_plan)
returns int
language sql immutable
as $$
  select case p
    when 'trial' then 25
    when 'basic' then 100
    when 'pro'   then 500
    else null            -- enterprise: unlimited
  end;
$$;

create or replace function public.plan_sms_bundle(p public.subscription_plan)
returns int
language sql immutable
as $$
  select case p
    when 'trial' then 10
    when 'basic' then 100
    when 'pro'   then 500
    else 2000
  end;
$$;

-- Whether a tenant is currently allowed to use the product.
create or replace function public.tenant_is_active(t public.tenants)
returns boolean
language sql stable
as $$
  select t.subscription_status = 'active'
     and case when t.subscription_plan = 'trial'
              then t.trial_ends_at > now()
              else coalesce(t.subscription_ends_at > now(), true)
         end;
$$;

-- -----------------------------------------------------------------------------
-- Guard triggers
-- -----------------------------------------------------------------------------

-- Tenant owners may edit their profile and preferences but never their own
-- plan / billing state; only super admin or the backend can.
create or replace function public.guard_tenant_billing_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_backend() or public.is_super_admin() then
    return new;
  end if;
  if new.subscription_plan    is distinct from old.subscription_plan
  or new.subscription_status  is distinct from old.subscription_status
  or new.trial_ends_at        is distinct from old.trial_ends_at
  or new.subscription_ends_at is distinct from old.subscription_ends_at then
    raise exception 'Only the platform can change subscription fields' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger tenants_guard_billing before update on public.tenants
  for each row execute function public.guard_tenant_billing_fields();

-- Users can never promote themselves or move between tenants.
create or replace function public.guard_user_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_backend() or public.is_super_admin() then
    return new;
  end if;
  if new.role is distinct from old.role or new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id then
    raise exception 'Not allowed to change role or tenant' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger users_guard_privileges before update on public.users
  for each row execute function public.guard_user_privileges();

-- Enforce the plan's product limit and block writes on expired tenants.
create or replace function public.enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t      public.tenants;
  lim    int;
  cnt    int;
begin
  select * into t from public.tenants where id = new.tenant_id for update;
  if not found then
    raise exception 'Unknown tenant';
  end if;
  if not public.tenant_is_active(t) then
    raise exception 'Subscription inactive — please renew to add products' using errcode = 'P0001';
  end if;
  lim := public.plan_product_limit(t.subscription_plan);
  if lim is not null then
    select count(*) into cnt from public.products where tenant_id = new.tenant_id;
    if cnt >= lim then
      raise exception 'Plan limit reached (% products on % plan). Upgrade to add more.', lim, t.subscription_plan
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger products_enforce_limit before insert on public.products
  for each row execute function public.enforce_product_limit();

-- -----------------------------------------------------------------------------
-- Signup: create the public.users row (and a tenant for self-signups).
--
-- * Self signup (supabase.auth.signUp with user metadata business_name, ...)
--   → a new tenant with a 14 day trial, user becomes its owner.
-- * Staff created by an owner through the server (auth.admin.createUser with
--   app_metadata {tenant_id, role:'staff'}) → joins that tenant.
--   app_metadata can only be written with the service role key, so a
--   malicious client cannot join someone else's tenant.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta          jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app_meta      jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  new_tenant_id uuid;
  invited_role  text := app_meta ->> 'role';
begin
  if app_meta ? 'tenant_id' and invited_role in ('staff', 'owner') then
    insert into public.users (id, tenant_id, email, phone, role, name)
    values (new.id, (app_meta ->> 'tenant_id')::uuid, new.email,
            coalesce(meta ->> 'phone', new.phone), invited_role::public.user_role, meta ->> 'name');
    return new;
  end if;

  if invited_role = 'super_admin' then
    insert into public.users (id, tenant_id, email, role, name)
    values (new.id, null, new.email, 'super_admin', meta ->> 'name');
    return new;
  end if;

  insert into public.tenants (business_name, business_type, phone, address)
  values (
    coalesce(nullif(trim(meta ->> 'business_name'), ''), split_part(coalesce(new.email, 'My Shop'), '@', 1)),
    nullif(trim(meta ->> 'business_type'), ''),
    nullif(trim(coalesce(meta ->> 'phone', new.phone)), ''),
    nullif(trim(meta ->> 'address'), '')
  )
  returning id into new_tenant_id;

  insert into public.sms_credits (tenant_id, balance, last_topup_at)
  values (new_tenant_id, public.plan_sms_bundle('trial'), now());

  insert into public.users (id, tenant_id, email, phone, role, name)
  values (new.id, new_tenant_id, new.email, nullif(trim(coalesce(meta ->> 'phone', new.phone)), ''),
          'owner', meta ->> 'name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Keep last_login fresh.
create or replace function public.handle_auth_user_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_sign_in_at is distinct from old.last_sign_in_at then
    update public.users set last_login = new.last_sign_in_at where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_login
  after update of last_sign_in_at on auth.users
  for each row execute function public.handle_auth_user_login();

-- -----------------------------------------------------------------------------
-- Reminder generation (idempotent — safe to run many times per day)
--
-- For every active product whose warranty/AMC expiry is between today and the
-- tenant's largest reminder window, create a reminder for the *current*
-- window only (the smallest configured N with days_left <= N). This means
--   * a missed cron day never loses a reminder (it is created the next day),
--   * a product added 10 days before expiry still gets its "15 day" reminder,
--   * we never burst-send 30/15/7 at once after downtime.
-- Duplicates are prevented by the unique constraint on reminders.
-- -----------------------------------------------------------------------------
create or replace function public.generate_due_reminders(
  run_date date default (now() at time zone 'Asia/Dhaka')::date
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted int;
begin
  with expiries as (
    select p.id as product_id, p.tenant_id, 'warranty'::public.reminder_type as rtype,
           p.warranty_expiry_date as expiry, t.reminder_days, c.phone, c.email
    from public.products p
    join public.tenants t   on t.id = p.tenant_id
    join public.customers c on c.id = p.customer_id
    where p.is_active and p.warranty_expiry_date is not null
      and public.tenant_is_active(t)
    union all
    select p.id, p.tenant_id, 'amc'::public.reminder_type,
           p.amc_expiry_date, t.reminder_days, c.phone, c.email
    from public.products p
    join public.tenants t   on t.id = p.tenant_id
    join public.customers c on c.id = p.customer_id
    where p.is_active and p.amc_expiry_date is not null
      and public.tenant_is_active(t)
  ),
  windows as (
    select e.*,
           (e.expiry - run_date) as days_left,
           (select min(d) from unnest(e.reminder_days) d where d >= (e.expiry - run_date)) as window_days
    from expiries e
    where e.expiry >= run_date
  ),
  channels as (
    select w.*, 'sms'::public.notify_channel as channel from windows w where w.window_days is not null
    union all
    select w.*, 'email'::public.notify_channel from windows w where w.window_days is not null
  )
  insert into public.reminders
    (tenant_id, product_id, reminder_type, days_before, expiry_date, scheduled_date, channel)
  select c.tenant_id, c.product_id, c.rtype, c.window_days, c.expiry, run_date, c.channel
  from channels c
  -- email reminders are generated only when someone can receive them
  -- (the sender also notifies the shop owner by email when enabled)
  where c.channel = 'sms' or c.email is not null
     or exists (select 1 from public.tenants t where t.id = c.tenant_id and t.notify_owner_email)
  on conflict (product_id, reminder_type, expiry_date, days_before, channel) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- Atomically consume SMS credits. Returns false (and consumes nothing) when
-- the balance is insufficient.
create or replace function public.consume_sms_credits(p_tenant uuid, p_count int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ok boolean;
begin
  update public.sms_credits
     set balance = balance - p_count
   where tenant_id = p_tenant and balance >= p_count
  returning true into ok;
  return coalesce(ok, false);
end;
$$;

create or replace function public.add_sms_credits(p_tenant uuid, p_count int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sms_credits (tenant_id, balance, last_topup_at)
  values (p_tenant, p_count, now())
  on conflict (tenant_id) do update
    set balance = public.sms_credits.balance + excluded.balance,
        last_topup_at = now();
end;
$$;

-- Mark subscriptions/trials that have run out.
create or replace function public.expire_lapsed_tenants()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  update public.tenants t
     set subscription_status = 'expired'
   where t.subscription_status = 'active'
     and not public.tenant_is_active(t);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- These backend-only functions must not be callable by end users via PostgREST.
revoke all on function public.generate_due_reminders(date)    from public, anon, authenticated;
revoke all on function public.consume_sms_credits(uuid, int)  from public, anon, authenticated;
revoke all on function public.add_sms_credits(uuid, int)      from public, anon, authenticated;
revoke all on function public.expire_lapsed_tenants()         from public, anon, authenticated;
revoke all on function public.handle_new_auth_user()          from public, anon, authenticated;
revoke all on function public.handle_auth_user_login()        from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- (select fn()) wrappers let Postgres evaluate the helper once per statement.
-- -----------------------------------------------------------------------------
alter table public.tenants            enable row level security;
alter table public.users              enable row level security;
alter table public.customers          enable row level security;
alter table public.products           enable row level security;
alter table public.reminders          enable row level security;
alter table public.notification_logs  enable row level security;
alter table public.subscriptions      enable row level security;
alter table public.sms_credits        enable row level security;
alter table public.cron_runs          enable row level security;

-- tenants ---------------------------------------------------------------------
create policy tenants_select on public.tenants for select to authenticated
  using (id = (select public.current_tenant_id()) or (select public.is_super_admin()));
create policy tenants_update_owner on public.tenants for update to authenticated
  using (id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner')
  with check (id = (select public.current_tenant_id()));
create policy tenants_super_admin_all on public.tenants for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- users -----------------------------------------------------------------------
create policy users_select on public.users for select to authenticated
  using (id = (select auth.uid())
         or tenant_id = (select public.current_tenant_id())
         or (select public.is_super_admin()));
-- everyone may edit their own profile (role/tenant guarded by trigger)
create policy users_update_self on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy users_super_admin_all on public.users for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
-- Staff creation/removal goes through the server (service role + auth admin API).

-- customers -------------------------------------------------------------------
create policy customers_select on public.customers for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) or (select public.is_super_admin()));
create policy customers_insert on public.customers for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()));
create policy customers_update on public.customers for update to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy customers_delete_owner on public.customers for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner');

-- products --------------------------------------------------------------------
create policy products_select on public.products for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) or (select public.is_super_admin()));
create policy products_insert on public.products for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()));
create policy products_update on public.products for update to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy products_delete_owner on public.products for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner');

-- reminders (read-only for tenants; written by the backend) -------------------
create policy reminders_select on public.reminders for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) or (select public.is_super_admin()));
create policy reminders_super_admin_update on public.reminders for update to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- notification_logs (read-only) -----------------------------------------------
create policy notification_logs_select on public.notification_logs for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) or (select public.is_super_admin()));

-- subscriptions: billing is owner-only; staff has no billing access -----------
create policy subscriptions_select on public.subscriptions for select to authenticated
  using ((tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner')
         or (select public.is_super_admin()));
create policy subscriptions_super_admin_all on public.subscriptions for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- sms_credits -----------------------------------------------------------------
create policy sms_credits_select on public.sms_credits for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) or (select public.is_super_admin()));
create policy sms_credits_super_admin_all on public.sms_credits for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- cron_runs: super admin only -------------------------------------------------
create policy cron_runs_super_admin on public.cron_runs for select to authenticated
  using ((select public.is_super_admin()));

-- Anonymous visitors get nothing; the public warranty page is served
-- server-side by token lookup with the service role.
revoke all on all tables in schema public from anon;
