# Hoppity — Attendance &amp; Team Console

An internal HR tool for Triffair / Hoppity: attendance recording, employee
management, leave management, and a credibility layer that reads activity
signals from Google Workspace and GitHub. Auth is Google sign-in locked to
`@triffair.com`.

## Stack

- **Frontend:** React 18 + Vite (plain JSX, matches HoppityWeb)
- **Auth + DB:** Supabase (Postgres, Auth, Row-Level Security, Edge Functions)
- **Signals:** Supabase Edge Function calling Google Admin SDK Reports API
- **Hosting:** Vercel (frontend), Supabase (backend)
- **Design:** Hoppity system — Playfair Display / Jost / JetBrains Mono, cream
  `#faf7f0`, saffron `#e8650a`, purple `#7C3AED` reserved for the logo

## What's where

```
src/                       frontend
  lib/policy.js            all leave/attendance rules as pure functions
  lib/supabase.js          Supabase client
  lib/useAuth.jsx          Google auth + domain gate
  App.jsx                  shell, data loading, mutations
  views.jsx                Dashboard, Clock, Signals, Team, Leave, Policy
supabase/
  schema.sql               tables + RLS + signup trigger (run first)
  cron.sql                 daily sync schedule
  functions/sync-workspace-activity/   Workspace signal puller (Deno)
docs/
  HANDOFF.md               >> START HERE — full setup runbook for Aditya
  ARCHITECTURE.md          data model + data flow
```

## Quickstart

```bash
npm install
cp .env.example .env          # fill in Supabase URL + anon key
npm run dev
```

You still need to run `supabase/schema.sql` and wire up Google auth before
sign-in works. Full sequence: **docs/HANDOFF.md**.
