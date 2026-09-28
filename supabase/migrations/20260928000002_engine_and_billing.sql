-- =============================================================================
-- Reminder queue helpers + subscription activation
-- =============================================================================

-- SMS language per shop ('en' = GSM-7, 160 chars/SMS; 'bn' = Unicode, 70 chars/SMS)
alter table public.tenants
  add column sms_language text not null default 'en' check (sms_language in ('en', 'bn')),
  -- which subscription/trial end date we last sent a "renew your plan" notice for
  add column renewal_notice_for timestamptz;

-- Claim a batch of due reminders for sending. Uses SKIP LOCKED plus a short
-- lease (next_attempt_at pushed forward) so two overlapping cron runs can
-- never send the same reminder twice.
create or replace function public.claim_due_reminders(p_limit int default 100, p_lease interval default '15 minutes')
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
      where status = 'pending' and next_attempt_at <= now()
      order by next_attempt_at
      limit p_limit
      for update skip locked
   )
  returning r.*;
end;
$$;

create or replace function public.refund_sms_credits(p_tenant uuid, p_count int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sms_credits set balance = balance + p_count where tenant_id = p_tenant;
end;
$$;

-- Activate a paid subscription (called after bKash confirms the payment).
-- Idempotent: activating an already-active row is a no-op.
-- The new period starts when the current paid period ends (early renewals
-- don't lose days), or now if it already lapsed / tenant was on trial.
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
         subscription_ends_at = v_end
   where id = t.id;

  perform public.add_sms_credits(t.id,
    public.plan_sms_bundle(s.plan) * case s.billing_cycle when 'yearly' then 12 else 1 end);

  return s;
end;
$$;

revoke all on function public.claim_due_reminders(int, interval) from public, anon, authenticated;
revoke all on function public.refund_sms_credits(uuid, int)       from public, anon, authenticated;
revoke all on function public.activate_subscription(uuid, text)  from public, anon, authenticated;
