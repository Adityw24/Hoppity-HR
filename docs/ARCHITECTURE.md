# Architecture

## The idea in one line

Attendance is a clock-in timestamp, but a timestamp alone is not credible for
distributed work. So the app records three things per person per day and reads
the **agreement between them** as the real signal:

1. **Declared** — what they clocked, and where from (office / coworking / home / travelling)
2. **Activity** — what their tools actually show (Drive edits, Calendar events, logins, GitHub commits)
3. **Planned vs done** — what they said they'd ship, and what they marked done

A normal day is all three cohering. You only spend attention where there's a
*pattern* of divergence over weeks — clocked full days, no activity, nothing
shipped. That is a conversation, not a daily location ping.

## Data model

| Table | Purpose |
|---|---|
| `profiles` | One row per team member, linked to `auth.users`. Role, dept, join date, schedule (`standard` = Mon–Fri, `sales-ops` = Wed–Sun), `is_admin`. |
| `pending_invites` | Admin pre-fills someone's details before their first login; merged in by the signup trigger. |
| `attendance` | One row per person per day: `clock_in`, `clock_out`, `work_mode`. Unique on `(employee_id, date)`. |
| `leave_requests` | PL / SL / CL with dates, day count, status, emergency flag, recorded policy warnings. |
| `holidays` | Date → name. 2 national days seeded; festivals added in-app. |
| `activity_signals` | Per person per day per source (drive/calendar/login/github). Written **only** by the edge function. |
| `daily_plan` | The third leg: intended outputs and their done state. |

## Auth + domain lock (triple-locked)

1. **Google OAuth consent screen = Internal** — only `triffair.com` org users can authorize at all.
2. **Signup trigger** (`handle_new_user`) raises an exception if the email isn't `@triffair.com`, and bootstraps the profile (first admin = `sabyasachi@triffair.com`).
3. **Client gate** (`useAuth.jsx`) signs out any non-triffair session before rendering.

## Authorization (RLS)

Everything runs through Postgres row-level security, so the rules hold even if
someone hits the API directly:

- Employees **see and record their own** attendance, leave, and plans.
- Employees can **read the roster, holidays, and leave** for team visibility.
- Only **admins** approve/decline leave, edit/archive members, and edit holidays.
- `activity_signals` is read-only to clients; only the edge function (service-role key) writes it.

`is_admin()` is a `SECURITY DEFINER` function so admin checks don't trigger
recursive RLS on `profiles`.

## Signal flow

```
pg_cron (daily 02:30 UTC / 08:00 IST)
   -> pg_net HTTP POST
       -> Edge Function: sync-workspace-activity
           -> service account JWT (domain-wide delegation, impersonates an admin)
           -> Admin SDK Reports API  (drive, calendar, login)
           -> aggregate events per actor per day
           -> upsert into activity_signals (service-role key, bypasses RLS)
   Signals view reads them back per person, beside declared + planned/done.
```

## Why login data is *not* the presence signal

Google fires `login_success` when a session is established (new device, password
change, token expiry) — not every morning. People stay signed in for weeks, so
login timestamps can't map to workdays. The Reports API gives **activity**
(Drive/Calendar) which is the meaningful, location-agnostic evidence. Login is
kept only as a weak hint.

## Known limits / where to extend

- **Edition gating:** Drive audit needs Business Standard+ (Starter is thin). The function logs and skips apps your edition doesn't expose.
- **Timezone:** the sync windows a day in UTC; IST (+5:30) means edges are fuzzy. Fine for daily rollups; tighten if you need exact day boundaries.
- **GitHub:** not wired yet. Add a second branch in the function (or a separate function) hitting the GitHub API per author and upserting `source = 'github'`.
- **Daily plan UI:** the `daily_plan` table and Signals display exist; a small "set today's plan" form is the natural next addition.
- **History views:** the frontend loads ~45 days of attendance; add date pickers / monthly reports as needed.
