# Warranty / AMC Renewal Reminder SaaS

Multi-tenant SaaS for electronics dealers, AMC providers, generator/solar installers and insurance agents.
Shops record what they sold. When a warranty or AMC is 30/15/7/1 days from expiry, the system sends an SMS
and email to the customer (and optionally to the shop owner). Every reminder is a chance to sell a renewal.

**Stack:** Next.js 14 (App Router) · Supabase (Postgres, Auth, RLS) · BD bulk SMS (Alpha/sms.net.bd, MiMSMS) ·
Resend (email) · bKash Tokenized Checkout.

---

## What's included

| Area | Features | Where |
|---|---|---|
| Multi-tenant core | Schema, RLS on every table, composite tenant FKs, DB-enforced plan limits | `supabase/migrations/*.sql` |
| Auth | Signup → shop + 14-day trial, login, forgot/reset password, profile & change password, role redirects | `src/app/(auth)`, `src/app/account` |
| Products & customers | Entry form with customer autocomplete, auto expiry dates, colour-coded list, search/filter/sort, archive, CSV import & export | `src/app/dashboard/products`, `…/customers` |
| Reminder engine | Daily window-based generation, SMS + email + **WhatsApp**, leased queue, retries, credit refunds, **daily SMS cap**, **custom SMS templates** (EN/BN), **“send now”** | `src/lib/reminders/*`, `/api/cron/reminders` |
| Renewal CRM | **Follow-up log** per product (contacted / interested / renewed / lost + next date), follow-ups due list, overdue list hides renewed/lost, **customer “request a renewal call”** from the SMS link → requests inbox | product page, `/dashboard/requests`, `/w/[token]` |
| Reports | Monthly expiries, reminders & SMS used, **renewal rate**, per-branch breakdown, CSV export, print to PDF | `/dashboard/reports` |
| Team | Staff (no delete / billing), **branches** with branch-scoped staff (Enterprise), **activity log** of every change (staff, API, platform admin) | `/dashboard/staff`, `/dashboard/branches`, `/dashboard/activity` |
| Billing | bKash plans **monthly or yearly (2 months free)**, **SMS top-up packs**, printable **invoices**, renewal reminders to shop owners | `/dashboard/billing` |
| API (Enterprise) | Hashed **API keys**, REST: products, customers, reminders | `/dashboard/api`, `/api/v1/*` |
| Super admin | MRR, revenue vs SMS cost chart, per-shop margin, tenants, plan/trial/credit/SMS-cap overrides, **manual (cash/bank) payments**, **payments list incl. failed**, onboarding, system health + resend, audit trail | `/super-admin` |

### Roles

| | Owner | Staff | Branch staff | Super admin |
|---|---|---|---|---|
| Add/edit products & customers, follow-ups, send now | ✅ | ✅ | ✅ (own branch only) | read (support) |
| Delete products & customers | ✅ | ❌ | ❌ | – |
| Billing, staff, branches, settings, API keys, activity log | ✅ | ❌ | ❌ | override + audit |
| All tenants | ❌ | ❌ | ❌ | ✅ |

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

The DB tests cover tenant isolation (read, write and cross-tenant foreign keys), privilege escalation, staff and
branch scoping, plan limits, reminder windows and idempotency, manual reminders, WhatsApp generation, queue leasing,
credits and the daily cap, audit log, SMS packs, and monthly/yearly subscription activation.

`npm run test:e2e` drives the whole app in Chromium against a running app and Supabase (see the header of
`tests/e2e/app.e2e.mjs`). It covers signup, products, CSV import, cron, the public page and renewal requests, staff,
branches, templates, send now, billing and invoices, the super admin panel, and the REST API.

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

| Plan | Monthly | Yearly | Products | SMS / month | Staff | Extras |
|---|---|---|---|---|---|---|
| Trial | free, 14 days | – | 25 | 10 | 1 | WhatsApp, templates |
| Basic | ৳500 | ৳5,000 | 100 | 100 | 1 | templates |
| Pro | ৳1,200 | ৳12,000 | 500 | 500 | 10 | + WhatsApp |
| Enterprise | custom | custom | unlimited | 2000 | unlimited | + branches, API |

SMS packs (any plan): 500 = ৳250, 1,000 = ৳450, 5,000 = ৳2,000. Enterprise is activated by the super admin
(manual payment or plan override).

## REST API (Enterprise)

Owners create keys under **Dashboard → API**. Only a SHA-256 hash is stored, and each key is shown once.
Send it as `Authorization: Bearer amc_…`.

| Endpoint | |
|---|---|
| `GET /api/v1/products?expiring_within=30&page=1&per_page=100` | list products |
| `POST /api/v1/products` | create; `customer_id` or `customer: {name, phone, email}` (matched by phone) |
| `GET /api/v1/products/:id` | product + customer + reminder history |
| `GET /api/v1/customers?phone=01…` / `POST /api/v1/customers` | look up / create (idempotent on phone) |
| `GET /api/v1/reminders?status=sent&since=…` | delivery status |

Writes through the API appear in the shop's activity log as `API: <key name>`.

## WhatsApp
Create a WhatsApp Cloud API app, approve a template (default name `warranty_reminder`) with 6 body variables:
`{{1}}` customer, `{{2}}` product, `{{3}}` warranty/AMC, `{{4}}` expiry date, `{{5}}` shop, `{{6}}` shop phone.
Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE` and `WHATSAPP_TEMPLATE_LANG`. Shops on Pro or
Enterprise turn it on in Settings. Each WhatsApp message uses 1 SMS credit. Without a token, messages are logged to the
console.

## Not included
- A Bangla-language dashboard. The UI is English; SMS can be sent in Bangla.
- Automatic recurring charges. bKash tokenized checkout is pay-per-period, and shops get a renewal reminder 3 days
  before their plan ends.
- API rate limiting beyond hashed keys and plan checks. Put the app behind Cloudflare or similar if you expose the API
  publicly.
