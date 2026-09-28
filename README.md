# Warranty / AMC Renewal Reminder SaaS

Multi-tenant SaaS for electronics dealers, AMC providers, generator/solar installers and insurance agents.
Shops record what they sold. When a warranty or AMC is 30/15/7/1 days from expiry, the system sends an SMS
and email to the customer (and optionally to the shop owner). Every reminder is a chance to sell a renewal.

**Stack:** Next.js 14 (App Router) · Supabase (Postgres, Auth, RLS) · BD bulk SMS (Alpha/sms.net.bd, MiMSMS) ·
Resend (email) · bKash Tokenized Checkout.

---

## What's included

| Blueprint phase | Where |
|---|---|
| 1. Multi-tenant schema + RLS | `supabase/migrations/*.sql` |
| 2. Signup → tenant + 14-day trial, role-based redirects | `src/app/(auth)`, `handle_new_auth_user()` trigger |
| 3. Product/customer entry, auto expiry dates, colour-coded list, CSV import | `src/app/dashboard/products`, `…/customers` |
| 4. Reminder engine (daily generate → send queue → retry) | `generate_due_reminders()` SQL + `src/lib/reminders/*` + `/api/cron/reminders` |
| 5. Super admin panel | `src/app/super-admin` |
| 6. bKash billing + "renew your plan" reminders to shop owners | `src/app/dashboard/billing`, `/api/bkash/callback`, `sendPlatformRenewalNotices()` |
| Customer status page (link in the SMS, no login) | `src/app/w/[token]` |

**Shop dashboard** (`/dashboard`): expiring this week and this month, overdue/missed renewals, products (search,
filter, sort, red = ≤7 days, yellow = ≤30 days), customers, reminder history and delivery log, monthly
report (print to PDF, CSV export), staff management, billing, and settings (reminder days, SMS language, owner copies).

**Super admin** (`/super-admin`): MRR, trials, lapsed shops, revenue vs SMS cost chart, SMS margin per shop,
tenant list and detail (support view), plan/status override, trial extension, SMS credit top-up, manual tenant
onboarding, and system health (last cron runs, queue, failed sends, resend failed reminders, run the job now).

### Roles

| | Owner | Staff | Super admin |
|---|---|---|---|
| Add/edit products & customers | ✅ | ✅ | read (support) |
| Delete products & customers | ✅ | ❌ (blocked by RLS) | – |
| Billing, staff, settings | ✅ | ❌ | override |
| All tenants | ❌ | ❌ | ✅ |

---

## How tenant isolation works

- Every business table has `tenant_id`. RLS policies allow a row only when
  `tenant_id = current_tenant_id()`, or when the caller is `super_admin`.
- `tenant_id` defaults to the caller's tenant, so the app never sends it from the client.
- `products → customers` and `reminders → products` use **composite foreign keys** on `(id, tenant_id)`, so a
  row can never point at another tenant's data, even through the service role.
- Triggers stop users changing their own `role`/`tenant_id` and stop owners changing their own plan or expiry.
- Staff membership comes from `app_metadata` (which only the service role can write), never from `user_metadata`
  (which any user can set at signup).
- Plan product limits and "subscription expired" are enforced **in the database** (`enforce_product_limit` trigger).
- Backend-only functions (`generate_due_reminders`, credit functions, `activate_subscription`) are revoked from
  `anon`/`authenticated`.
- The service-role client (`src/lib/supabase/admin.ts`) is only used after an explicit permission check
  (cron secret, owner check, super admin check) or for the unguessable-token public page.

## How the reminder engine works

1. **Generate** (`generate_due_reminders`, idempotent): for each active product whose warranty/AMC expiry is ahead,
   create a reminder for the **current window only**, which is the smallest configured N with `days_left ≤ N`. A missed
   cron day never loses a reminder, a product added 10 days before expiry still gets its "15 day" reminder, and
   the job never sends 30/15/7 together after downtime. A unique key prevents duplicates.
2. **Send** (`processReminderQueue`): claims due reminders with `FOR UPDATE SKIP LOCKED` plus a 15-minute lease, so
   overlapping runs can't double-send. It cancels a reminder when the product was deleted or archived, when its expiry
   date was changed (for example, an AMC renewal), or when the shop's plan lapsed.
3. **SMS credits** are deducted atomically per SMS part, and refunded if the provider call fails.
4. **Retry**: on failure the job retries with backoff (30 min, 2 h), then marks the reminder `failed` after 3 attempts.
   The super admin can re-queue failed reminders.
5. Every message is logged in `notification_logs` with SMS parts and provider cost, so you can track margins.

SMS text is kept to one part (≤160 chars in English). Bangla SMS (`sms_language = bn`) uses Unicode at 70 chars
per part and costs more credits.

---

## Local development

```bash
npm install
cp .env.example .env.local      # fill in values
npx supabase start              # needs Docker; applies supabase/migrations
npm run dev
```

`npx supabase start` prints the API URL, anon key and service role key for `.env.local`.
With `SMS_PROVIDER=console` and no `RESEND_API_KEY`, messages are logged to the terminal instead of being sent.

Trigger the reminder job by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reminders
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/reminders?mode=send"   # queue/retries only
```

### Tests

```bash
npm test          # runs every migration on PGlite (real Postgres, WASM) + unit tests
npm run typecheck && npm run lint && npm run build
```

The DB tests cover tenant isolation (read, write and cross-tenant foreign keys), privilege escalation, staff
permissions, plan limits, reminder windows and idempotency, queue leasing, credits, and subscription activation.

---

## Deploying

### 1. Supabase
1. Create a project and run the migrations: `npx supabase link --project-ref <ref> && npx supabase db push`.
2. Auth → URL configuration: set Site URL to your domain and add `https://your-domain/auth/callback` as a redirect URL.
3. Copy the URL, anon key and service role key into your hosting environment.

### 2. Create your super admin account
Run this once from any machine with the service role key:

```js
// node create-admin.mjs
import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
await admin.auth.admin.createUser({
  email: "you@example.com", password: "a-long-password", email_confirm: true,
  app_metadata: { role: "super_admin" },
});
```

### 3. App hosting
- **Vercel:** set the env vars from `.env.example`. `vercel.json` schedules the daily job at 03:00 UTC (09:00 Dhaka)
  and an hourly queue/retry run. Vercel sends `CRON_SECRET` automatically. The Hobby plan only allows daily
  crons, so remove the hourly entry there. Retries then happen on the next daily run.
- **VPS (PM2):** `npm run build && pm2 start npm --name amc -- start`, then add crontab entries:
  ```cron
  0 9 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/reminders
  30 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://your-domain/api/cron/reminders?mode=send"
  ```
  (Set `TZ=Asia/Dhaka` for crontab or convert the times.)
- **Supabase pg_cron alternative:** enable `pg_cron` and `pg_net`, then:
  ```sql
  select cron.schedule('amc-daily', '0 3 * * *', $$
    select net.http_get(url := 'https://your-domain/api/cron/reminders',
                        headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'));
  $$);
  ```

### 4. SMS provider
Set `SMS_PROVIDER` to `alpha` (sms.net.bd) or `mimsms`, plus `SMS_API_KEY` and `SMS_SENDER_ID` (a masking or
non-masking sender approved by your provider). Adapters live in `src/lib/notify/sms.ts`. **Send one test SMS and
check the response format against your account's API docs before going live.** Providers differ, and the success
check parses their JSON. Set `SMS_COST_PER_MESSAGE` to your real per-part rate so the super admin margin numbers are
correct.

### 5. bKash
Fill in the `BKASH_*` variables (start with the sandbox base URL). The callback URL is
`$NEXT_PUBLIC_APP_URL/api/bkash/callback`. The amount always comes from the server-side plan table. On callback,
the payment is executed and verified with bKash, and the amount is checked, before `activate_subscription()`
extends the plan by one month (stacked on top of any remaining paid time) and adds the plan's SMS bundle.

---

## Plans

Defined in `src/lib/plans.ts` and mirrored in SQL (`plan_product_limit`, `plan_sms_bundle`). Update both together.

| Plan | Price | Products | SMS / month | Staff |
|---|---|---|---|---|
| Trial | free, 14 days | 25 | 10 | 1 |
| Basic | ৳500 | 100 | 100 | 1 |
| Pro | ৳1200 | 500 | 500 | 10 |
| Enterprise | custom (set by super admin) | unlimited | 2000 | unlimited |

## Known gaps / next steps
- WhatsApp channel (enum exists; no sender yet).
- Buying extra SMS packs with bKash (the super admin can add credits by hand for now).
- Enterprise multi-branch and API access.
- A per-day SMS send cap per tenant, if you want protection against runaway imports.
