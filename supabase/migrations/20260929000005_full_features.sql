-- =============================================================================
-- Full feature set:
--   * branches (enterprise multi-branch) + branch-scoped staff
--   * renewal CRM: follow-ups and customer renewal requests
--   * per-shop SMS templates, WhatsApp channel, daily SMS cap
--   * manual "send now" reminders
--   * SMS top-up packs and yearly billing
--   * API keys (enterprise REST API)
--   * activity (audit) log
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Branches
-- -----------------------------------------------------------------------------
create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 120),
  address     text,
  phone       text,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, name)
);

alter table public.users
  add column branch_id uuid,
  add constraint users_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete set null (branch_id);

-- Branch of the signed-in user (null = sees every branch).
create or replace function public.current_branch_id()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
begin
  return (select u.branch_id from public.users u where u.id = auth.uid());
end;
$$;

alter table public.products
  add column branch_id uuid default public.current_branch_id(),
  add constraint products_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete set null (branch_id);
create index products_branch_idx on public.products (tenant_id, branch_id);

-- Branch-scoped staff only see / write their branch's products.
drop policy products_select on public.products;
drop policy products_insert on public.products;
drop policy products_update on public.products;
create policy products_select on public.products for select to authenticated
  using ((tenant_id = (select public.current_tenant_id())
          and ((select public.current_branch_id()) is null or branch_id = (select public.current_branch_id())))
         or (select public.is_super_admin()));
create policy products_insert on public.products for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and ((select public.current_branch_id()) is null or branch_id = (select public.current_branch_id())));
create policy products_update on public.products for update to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.current_branch_id()) is null or branch_id = (select public.current_branch_id())))
  with check (tenant_id = (select public.current_tenant_id())
              and ((select public.current_branch_id()) is null or branch_id = (select public.current_branch_id())));

alter table public.branches enable row level security;
create policy branches_select on public.branches for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) or (select public.is_super_admin()));
create policy branches_owner_write on public.branches for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner');

-- Users may not move themselves between branches either.
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
     or new.id is distinct from old.id or new.branch_id is distinct from old.branch_id then
    raise exception 'Not allowed to change role or tenant' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Renewal CRM
-- -----------------------------------------------------------------------------
create table public.product_followups (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
  product_id  uuid not null,
  outcome     text not null check (outcome in ('note', 'contacted', 'no_answer', 'interested', 'renewed', 'lost')),
  note        text check (length(note) <= 2000),
  next_follow_up date,
  created_by  uuid default auth.uid() references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (product_id, tenant_id) references public.products (id, tenant_id) on delete cascade
);
create index product_followups_product_idx on public.product_followups (product_id, created_at desc);
create index product_followups_tenant_idx on public.product_followups (tenant_id, created_at desc);

alter table public.product_followups enable row level security;
create policy followups_select on public.product_followups for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) or (select public.is_super_admin()));
create policy followups_insert on public.product_followups for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and created_by = (select auth.uid()));
create policy followups_delete_owner on public.product_followups for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner');

-- Customer clicked "Request renewal" on the public status page.
create table public.renewal_requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  product_id  uuid not null,
  message     text check (length(message) <= 500),
  callback_phone text,
  status      text not null default 'new' check (status in ('new', 'handled')),
  handled_by  uuid references public.users (id) on delete set null,
  handled_at  timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (product_id, tenant_id) references public.products (id, tenant_id) on delete cascade
);
create index renewal_requests_tenant_idx on public.renewal_requests (tenant_id, status, created_at desc);

alter table public.renewal_requests enable row level security;
create policy renewal_requests_select on public.renewal_requests for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) or (select public.is_super_admin()));
create policy renewal_requests_update on public.renewal_requests for update to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- inserts come from the public page through the server (service role)

-- -----------------------------------------------------------------------------
-- Messaging settings
-- -----------------------------------------------------------------------------
alter table public.tenants
  add column sms_template text check (length(sms_template) <= 480),
  add column whatsapp_enabled boolean not null default false,
  add column sms_daily_cap int not null default 300 check (sms_daily_cap between 1 and 100000);

alter table public.sms_credits
  add column used_today int not null default 0,
  add column used_on date;

-- Consume credits, respecting the shop's daily cap.
-- Returns 'ok' | 'insufficient' | 'daily_cap'.
create or replace function public.consume_sms_credits_capped(p_tenant uuid, p_count int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap   int;
  today date := (now() at time zone 'Asia/Dhaka')::date;
  c     public.sms_credits;
begin
  select sms_daily_cap into cap from public.tenants where id = p_tenant;
  select * into c from public.sms_credits where tenant_id = p_tenant for update;
  if not found or c.balance < p_count then
    return 'insufficient';
  end if;
  if coalesce(case when c.used_on = today then c.used_today end, 0) + p_count > coalesce(cap, 300) then
    return 'daily_cap';
  end if;
  update public.sms_credits
     set balance = balance - p_count,
         used_today = case when used_on = today then used_today + p_count else p_count end,
         used_on = today
   where tenant_id = p_tenant;
  return 'ok';
end;
$$;

create or replace function public.refund_sms_credits(p_tenant uuid, p_count int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sms_credits
     set balance = balance + p_count,
         used_today = greatest(0, used_today - p_count)
   where tenant_id = p_tenant;
end;
$$;

-- -----------------------------------------------------------------------------
-- Manual reminders ("send now") — not bound by the de-dup key or window rule
-- -----------------------------------------------------------------------------
alter table public.reminders add column is_manual boolean not null default false;
alter table public.reminders add column created_by uuid references public.users (id) on delete set null;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.reminders'::regclass and contype in ('u', 'c')
              and (pg_get_constraintdef(oid) ilike '%days_before%')
  loop
    execute format('alter table public.reminders drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.reminders add constraint reminders_days_before_check check (is_manual or days_before > 0);
create unique index reminders_dedupe_uniq on public.reminders (product_id, reminder_type, expiry_date, days_before, channel)
  where not is_manual;

-- Regenerated: adds the WhatsApp channel and uses the partial de-dup index.
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
           p.warranty_expiry_date as expiry, t.reminder_days, t.whatsapp_enabled, t.notify_owner_email, c.phone, c.email
    from public.products p
    join public.tenants t   on t.id = p.tenant_id
    join public.customers c on c.id = p.customer_id
    where p.is_active and p.warranty_expiry_date is not null
      and public.tenant_is_active(t)
    union all
    select p.id, p.tenant_id, 'amc'::public.reminder_type,
           p.amc_expiry_date, t.reminder_days, t.whatsapp_enabled, t.notify_owner_email, c.phone, c.email
    from public.products p
    join public.tenants t   on t.id = p.tenant_id
    join public.customers c on c.id = p.customer_id
    where p.is_active and p.amc_expiry_date is not null
      and public.tenant_is_active(t)
  ),
  windows as (
    select e.*,
           (select min(d) from unnest(e.reminder_days) d where d >= (e.expiry - run_date)) as window_days
    from expiries e
    where e.expiry >= run_date
  ),
  channels as (
    select w.*, 'sms'::public.notify_channel as channel from windows w where w.window_days is not null
    union all
    select w.*, 'email'::public.notify_channel from windows w
     where w.window_days is not null and (w.email is not null or w.notify_owner_email)
    union all
    select w.*, 'whatsapp'::public.notify_channel from windows w
     where w.window_days is not null and w.whatsapp_enabled and w.phone is not null
  )
  insert into public.reminders
    (tenant_id, product_id, reminder_type, days_before, expiry_date, scheduled_date, channel)
  select c.tenant_id, c.product_id, c.rtype, c.window_days, c.expiry, run_date, c.channel
  from channels c
  on conflict (product_id, reminder_type, expiry_date, days_before, channel) where not is_manual do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- Claim specific reminders (used by "send now") with the same lease semantics.
create or replace function public.claim_reminders_by_id(p_ids uuid[], p_lease interval default '15 minutes')
returns setof public.reminders
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.reminders r
     set next_attempt_at = now() + p_lease
   where r.id in (
     select id from public.reminders
      where id = any (p_ids) and status = 'pending'
      for update skip locked
   )
  returning r.*;
end;
$$;

-- -----------------------------------------------------------------------------
-- Billing: SMS packs + yearly
-- -----------------------------------------------------------------------------
alter table public.subscriptions
  add column kind text not null default 'plan' check (kind in ('plan', 'sms_pack')),
  add column sms_pack_size int check (sms_pack_size is null or sms_pack_size > 0),
  add column invoice_no bigint generated always as identity;

create or replace function public.activate_subscription(p_subscription uuid, p_trx_id text)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.subscriptions;
  t        public.tenants;
  v_start  timestamptz;
  v_end    timestamptz;
begin
  select * into s from public.subscriptions where id = p_subscription for update;
  if not found then
    raise exception 'subscription % not found', p_subscription;
  end if;
  if s.status = 'active' then
    return s;
  end if;

  if s.kind = 'sms_pack' then
    update public.subscriptions
       set status = 'active', starts_at = now(), provider_trx_id = p_trx_id
     where id = s.id
    returning * into s;
    perform public.add_sms_credits(s.tenant_id, s.sms_pack_size);
    return s;
  end if;

  select * into t from public.tenants where id = s.tenant_id for update;

  v_start := greatest(now(),
                      case when t.subscription_plan <> 'trial' and t.subscription_status = 'active'
                           then coalesce(t.subscription_ends_at, now()) else now() end);
  v_end := v_start + case s.billing_cycle when 'yearly' then interval '1 year' else interval '1 month' end;

  update public.subscriptions
     set status = 'active', starts_at = v_start, ends_at = v_end, provider_trx_id = p_trx_id
   where id = s.id
  returning * into s;

  update public.tenants
     set subscription_plan = s.plan,
         subscription_status = 'active',
         subscription_ends_at = v_end,
         renewal_notice_for = null
   where id = t.id;

  perform public.add_sms_credits(t.id,
    public.plan_sms_bundle(s.plan) * case s.billing_cycle when 'yearly' then 12 else 1 end);

  return s;
end;
$$;

-- Monthly SMS bundle for yearly subscribers is granted up-front (x12);
-- monthly subscribers get it on each payment.

-- -----------------------------------------------------------------------------
-- API keys (enterprise REST API). Only a SHA-256 hash is stored.
-- -----------------------------------------------------------------------------
create table public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 100),
  key_prefix    text not null,
  key_hash      text not null unique,
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index api_keys_tenant_idx on public.api_keys (tenant_id);

alter table public.api_keys enable row level security;
create policy api_keys_owner_select on public.api_keys for select to authenticated
  using ((tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner')
         or (select public.is_super_admin()));
-- creation / revocation go through the server after an owner check
revoke insert, update, delete on public.api_keys from authenticated;

-- -----------------------------------------------------------------------------
-- Activity log (audit trail). Written by triggers and by the server.
-- -----------------------------------------------------------------------------
create table public.activity_logs (
  id          bigint generated always as identity primary key,
  tenant_id   uuid references public.tenants (id) on delete cascade,
  actor_id    uuid,
  actor_label text,
  action      text not null,
  entity      text,
  entity_id   uuid,
  summary     text,
  created_at  timestamptz not null default now()
);
create index activity_logs_tenant_idx on public.activity_logs (tenant_id, created_at desc);

alter table public.activity_logs enable row level security;
create policy activity_logs_select on public.activity_logs for select to authenticated
  using ((tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner')
         or (select public.is_super_admin()));
revoke insert, update, delete on public.activity_logs from authenticated, anon;

create or replace function public.log_row_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec     jsonb := to_jsonb(coalesce(new, old));
  label   text;
  actor   uuid := auth.uid();
  who     text;
begin
  -- rows removed by a tenant-wide cascade delete: nothing to log against
  if not exists (select 1 from public.tenants where id = (rec ->> 'tenant_id')::uuid) then
    return null;
  end if;
  label := coalesce(rec ->> 'product_name', rec ->> 'name', rec ->> 'outcome', '');
  if actor is not null then
    select coalesce(u.name, u.email) into who from public.users u where u.id = actor;
  else
    -- server-side callers (service role) identify themselves with an x-actor
    -- request header, which PostgREST exposes as request.headers
    who := coalesce(
      nullif(left(nullif(current_setting('request.headers', true), '')::json ->> 'x-actor', 100), ''),
      'system');
  end if;
  insert into public.activity_logs (tenant_id, actor_id, actor_label, action, entity, entity_id, summary)
  values ((rec ->> 'tenant_id')::uuid, actor, who, lower(tg_op), tg_table_name, (rec ->> 'id')::uuid, left(label, 200));
  return null;
end;
$$;

create trigger products_activity after insert or update or delete on public.products
  for each row execute function public.log_row_activity();
create trigger customers_activity after insert or update or delete on public.customers
  for each row execute function public.log_row_activity();
create trigger branches_activity after insert or update or delete on public.branches
  for each row execute function public.log_row_activity();
create trigger followups_activity after insert on public.product_followups
  for each row execute function public.log_row_activity();

-- -----------------------------------------------------------------------------
-- Grants hygiene
-- -----------------------------------------------------------------------------
revoke all on function public.consume_sms_credits_capped(uuid, int)          from public, anon, authenticated;
revoke all on function public.refund_sms_credits(uuid, int)                  from public, anon, authenticated;
revoke all on function public.claim_reminders_by_id(uuid[], interval)       from public, anon, authenticated;
revoke all on function public.activate_subscription(uuid, text)             from public, anon, authenticated;
revoke all on function public.generate_due_reminders(date)                  from public, anon, authenticated;
revoke all on function public.log_row_activity()                            from public, anon, authenticated;
revoke all on all tables in schema public from anon;
