# Handoff &amp; setup runbook

For: **Aditya**. This takes the app from zero to live. Do the parts in order.
Parts 1–6 get a working app (attendance + leave + team, with Google login).
Part 7 is the credibility/Workspace layer and can wait — it needs Workspace
admin access.

The code is done. What's left is wiring it to Triffair's own Google and
Supabase, because those steps need account-level access and secrets that can't
ship in a repo.

---

## 0. Prerequisites

- Node 18+ and npm
- Access to the Supabase project (`wenhudcyvlhilpgazylg`) — ask Sab to add you
- A Google account with **Workspace admin** rights on `triffair.com` (Sab) for Parts 4 and 7
- Supabase CLI for the edge function: `npm i -g supabase`

---

## 1. Run locally

```bash
cd hoppity-hr
npm install
cp .env.example .env
```

Fill `.env` from Supabase → Project Settings → API:

```
VITE_SUPABASE_URL=https://wenhudcyvlhilpgazylg.supabase.co
VITE_SUPABASE_ANON_KEY=<the anon public key>
```

```bash
npm run dev      # http://localhost:5173
```

Sign-in won't work until Parts 2–4 are done. That's expected.

---

## 2. Create the database

Supabase → **SQL Editor** → paste the whole of `supabase/schema.sql` → Run.

This creates every table, the RLS policies, the signup trigger (which locks
signups to `@triffair.com` and makes `sabyasachi@triffair.com` the first admin),
and seeds the national holidays. Safe to re-run.

---

## 3. Create the Google OAuth client

In **Google Cloud Console** (use the Triffair Workspace account):

1. Pick or create a project (you can reuse the Hoppity app's project).
2. **APIs &amp; Services → OAuth consent screen**:
   - User type: **Internal**. This is the main domain lock — only `triffair.com`
     users can sign in. Don't pick External.
   - App name "Hoppity HR", support email, save.
3. **APIs &amp; Services → Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application**
   - **Authorized redirect URI:** copy it from Supabase → Authentication →
     Providers → Google (it looks like
     `https://wenhudcyvlhilpgazylg.supabase.co/auth/v1/callback`). Paste that here.
   - Create. Copy the **Client ID** and **Client secret**.

---

## 4. Turn on Google auth in Supabase

Supabase → **Authentication → Providers → Google**:

- Enable it, paste the Client ID and Client secret from Part 3, save.

Supabase → **Authentication → URL Configuration**:

- **Site URL:** your Vercel URL (set after Part 6; use `http://localhost:5173`
  for now).
- **Redirect URLs:** add both `http://localhost:5173` and the Vercel URL.

Now sign-in works. The first person to sign in should be **Sab**, so the trigger
makes him admin. After that:

- Sab opens **Team → Invite member**, adds each person's `@triffair.com` email
  plus role/dept/join date/schedule.
- Each invited person signs in once; the trigger merges their invite into a
  profile. They appear on the roster automatically.

> Set Riya (and anyone else client-facing) to the **Wed–Sun** schedule. Everyone
> else stays Mon–Fri. Edit join dates so leave balances and the 1-year PL gate
> are correct.

To make someone else an admin, run in SQL Editor:
`update profiles set is_admin = true where email = 'name@triffair.com';`

---

## 5. Smoke test

- Sign in as Sab → you should land on **Today**.
- **Clock** → pick a work mode → Clock in → Clock out. Check the time and `late`/`short` flags.
- **Leave** → Apply → try a CL with 2 days notice (should warn) and a PL of 3 days (should error). Approve one as admin.
- **Team** → balances reflect approved leave. Export the CSVs.
- Sign in as a non-triffair Google account in an incognito window → it must be rejected.

---

## 6. Deploy to Vercel

Same flow as your other Hoppity apps.

```bash
# from the repo root, or import the repo in the Vercel dashboard
vercel
```

- Framework preset: **Vite**. Build `npm run build`, output `dist`.
- **Environment variables** (Project → Settings → Environment Variables):
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- After the first deploy, put the live URL into Supabase Site URL + Redirect
  URLs (Part 4) and into the Google client's authorized redirect (Part 3) only
  if you change the Supabase callback — you don't, so Google needs no change.

That's the full HR app live: attendance, leave, team, payroll CSV exports.

---

## 7. (Optional, later) The Workspace credibility layer

This fills the **Signals** tab with real Drive/Calendar/login activity per
person. It needs Workspace admin access and a service account. **Read the
consent note at the bottom before switching this on.**

### 7a. Service account + API

Google Cloud Console (same project):

1. **Enable the Admin SDK API** (APIs &amp; Services → Library → "Admin SDK API" → Enable).
2. **IAM &amp; Admin → Service Accounts → Create** ("hoppity-reports"). No roles needed.
3. Open it → **Keys → Add key → JSON**. Download it. Keep it secret.
4. Note the service account's **Unique ID** (a long number) — also called Client ID.

### 7b. Domain-wide delegation

Google **Admin Console** (admin.google.com, as super-admin):

- **Security → Access and data control → API controls → Domain-wide delegation → Add new**
- **Client ID:** the service account's Unique ID from 7a.
- **Scopes:** `https://www.googleapis.com/auth/admin.reports.audit.readonly`
- Authorize.

### 7c. Deploy the function + secrets

```bash
supabase link --project-ref wenhudcyvlhilpgazylg

# paste the service account JSON as one line; GOOGLE_ADMIN_EMAIL is a super-admin to impersonate
supabase secrets set GOOGLE_SA_KEY="$(cat path/to/service-account.json | tr -d '\n')"
supabase secrets set GOOGLE_ADMIN_EMAIL="sabyasachi@triffair.com"
supabase secrets set SYNC_SECRET="$(openssl rand -hex 24)"   # save this value

supabase functions deploy sync-workspace-activity
```

Test it (use the SYNC_SECRET you just set):

```bash
curl -X POST "https://wenhudcyvlhilpgazylg.supabase.co/functions/v1/sync-workspace-activity?date=2026-06-22&key=YOUR_SYNC_SECRET" \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY"
# -> {"ok":true,"date":"2026-06-22","signals":N}
```

Open the **Signals** tab — you should see activity counts next to people.

> If an app returns 400 in the logs, your Workspace edition doesn't expose that
> audit source (Drive needs Business Standard+). Calendar and login work on more
> tiers. The function skips what it can't read.

### 7d. Schedule it daily

In Supabase SQL Editor, set the Vault secrets and run `supabase/cron.sql`
(it has the three `vault.create_secret` lines to fill in first). It runs the
function every morning at 08:00 IST for the previous day.

### 7e. GitHub signals (when you want them)

For Aditya/Dipak, commits are the real signal. Add a branch to the function (or
a sibling function) that hits the GitHub API for the day's commits per author
and upserts rows with `source = 'github'`. The Signals view already renders any
source generically.

---

## Operations notes

- **Payroll:** Team → Attendance CSV is the export. No clock entry for a working
  day reads as absent, per policy. Admins can correct a record (RLS allows admin
  edits) — add a small edit UI if manual correction becomes frequent.
- **Festival holidays:** add each year in Team → Add holiday. Leave validation
  and weekly-off logic both respect them.
- **Schedules:** `standard` = off Sat/Sun; `sales-ops` = off Tue/Thu (the
  proposed Wed–Sun client-coverage shift).
- **Leave rules** live in one place: `src/lib/policy.js`. Change entitlements or
  notice periods there and both the UI and validation follow.
- **Tightening privacy:** leave rows are currently readable by all signed-in
  users (team transparency). If reasons should be private, change the `lv_select`
  policy in `schema.sql` to `employee_id = auth.uid() or is_admin()` and adjust
  the dashboard's "on leave" display.

## A consent note before turning on Part 7

Reading people's Workspace activity is monitoring, even when the intent is fair.
The healthy version is transparent: tell the team what's collected (event
counts, not content), why (so remote and coworking days are credible without
location tracking), and who sees it (admins, and each person their own). Put it
in the attendance policy and get acknowledgement before the sync goes live. The
tool is built to make the honest path easy; keeping it trusted is a culture
choice, not a code one.
