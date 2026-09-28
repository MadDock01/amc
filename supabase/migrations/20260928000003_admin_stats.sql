-- =============================================================================
-- Super admin aggregates (callable only by super_admin users)
-- =============================================================================

-- Revenue (confirmed payments) vs SMS provider cost per month, last N months.
create or replace function public.admin_monthly_stats(p_months int default 6)
returns table (month date, revenue numeric, sms_segments bigint, sms_cost numeric, new_tenants bigint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with months as (
    select generate_series(
             date_trunc('month', (now() at time zone 'Asia/Dhaka'))::date - make_interval(months => p_months - 1),
             date_trunc('month', (now() at time zone 'Asia/Dhaka'))::date,
             interval '1 month')::date as m
  )
  select m.m,
         coalesce((select sum(s.amount) from public.subscriptions s
                    where s.status = 'active'
                      and date_trunc('month', s.created_at at time zone 'Asia/Dhaka')::date = m.m), 0),
         coalesce((select sum(l.sms_segments) from public.notification_logs l
                    where l.channel = 'sms' and l.status = 'sent'
                      and date_trunc('month', l.sent_at at time zone 'Asia/Dhaka')::date = m.m), 0)::bigint,
         coalesce((select sum(l.cost) from public.notification_logs l
                    where l.channel = 'sms' and l.status = 'sent'
                      and date_trunc('month', l.sent_at at time zone 'Asia/Dhaka')::date = m.m), 0),
         (select count(*) from public.tenants t
           where date_trunc('month', t.created_at at time zone 'Asia/Dhaka')::date = m.m)
  from months m
  order by m.m;
end;
$$;

-- Per-tenant usage since a date: SMS parts + cost, products, failed reminders.
create or replace function public.admin_tenant_usage(p_since timestamptz)
returns table (tenant_id uuid, sms_segments bigint, sms_cost numeric, products bigint, failed_reminders bigint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select t.id,
         coalesce((select sum(l.sms_segments) from public.notification_logs l
                    where l.tenant_id = t.id and l.channel = 'sms' and l.status = 'sent' and l.sent_at >= p_since), 0)::bigint,
         coalesce((select sum(l.cost) from public.notification_logs l
                    where l.tenant_id = t.id and l.channel = 'sms' and l.status = 'sent' and l.sent_at >= p_since), 0),
         (select count(*) from public.products p where p.tenant_id = t.id),
         (select count(*) from public.reminders r where r.tenant_id = t.id and r.status = 'failed')
  from public.tenants t;
end;
$$;

revoke all on function public.admin_monthly_stats(int)          from public, anon;
revoke all on function public.admin_tenant_usage(timestamptz)   from public, anon;
grant execute on function public.admin_monthly_stats(int)        to authenticated;
grant execute on function public.admin_tenant_usage(timestamptz) to authenticated;
