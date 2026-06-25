// ===========================================================================
// sync-workspace-activity — Supabase Edge Function (Deno).
//
// Pulls Google Workspace activity (Drive, Calendar, login) via the Admin SDK
// Reports API and writes per-person daily signals into activity_signals.
// This is the "activity" leg of the credibility model. It runs server-side
// because it needs a service-account key with domain-wide delegation — that
// key must NEVER live in frontend code.
//
// Secrets (set with `supabase secrets set`):
//   GOOGLE_SA_KEY       full service-account JSON (one line)
//   GOOGLE_ADMIN_EMAIL  a Workspace super-admin to impersonate (e.g. sabyasachi@triffair.com)
//   SYNC_SECRET         a random string; callers must send it as ?key= or x-sync-key header
// Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY automatically.
//
// Invoke (admin only, or via the daily cron in supabase/cron.sql):
//   POST /functions/v1/sync-workspace-activity?date=2026-06-23&key=SYNC_SECRET
// ===========================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APPS = ["drive", "calendar", "login"]; // add 'token','meet' as needed (edition-gated)
const SCOPE = "https://www.googleapis.com/auth/admin.reports.audit.readonly";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const provided = url.searchParams.get("key") || req.headers.get("x-sync-key");
    if (provided !== Deno.env.get("SYNC_SECRET")) {
      return json({ error: "unauthorized" }, 401);
    }

    // Default to yesterday (audit logs lag a few hours).
    const date = url.searchParams.get("date") || yesterday();
    const startTime = `${date}T00:00:00.000Z`;
    const endTime = `${date}T23:59:59.999Z`;

    const accessToken = await getAccessToken();

    // Map actor email -> profile id so we only store known team members.
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profiles } = await supabase.from("profiles").select("id,email");
    const idByEmail = new Map((profiles || []).map((p: any) => [p.email.toLowerCase(), p.id]));

    const rows: any[] = [];
    for (const app of APPS) {
      const counts = await countEventsByActor(accessToken, app, startTime, endTime);
      for (const [email, count] of counts) {
        const empId = idByEmail.get(email.toLowerCase());
        if (!empId) continue; // ignore non-team / system actors
        rows.push({
          employee_id: empId,
          date,
          source: app,
          metric: "events",
          value: `${count} ${app === "login" ? "logins" : "events"}`,
          raw: { count },
        });
      }
    }

    if (rows.length) {
      const { error } = await supabase
        .from("activity_signals")
        .upsert(rows, { onConflict: "employee_id,date,source,metric" });
      if (error) return json({ error: error.message }, 500);
    }

    return json({ ok: true, date, signals: rows.length });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

// --- pull + aggregate one application's activity for the window ---
async function countEventsByActor(token: string, app: string, startTime: string, endTime: string) {
  const counts = new Map<string, number>();
  let pageToken: string | undefined;
  do {
    const u = new URL(`https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/${app}`);
    u.searchParams.set("startTime", startTime);
    u.searchParams.set("endTime", endTime);
    u.searchParams.set("maxResults", "1000");
    if (pageToken) u.searchParams.set("pageToken", pageToken);

    const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      // A 400 here usually means this app isn't available on your edition.
      console.warn(`reports ${app}: ${res.status} ${await res.text()}`);
      break;
    }
    const data = await res.json();
    for (const item of data.items || []) {
      const email = item?.actor?.email;
      if (!email) continue;
      const n = (item.events || []).length || 1;
      counts.set(email, (counts.get(email) || 0) + n);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return counts;
}

// --- service-account JWT -> access token (domain-wide delegation) ---
async function getAccessToken(): Promise<string> {
  const sa = JSON.parse(Deno.env.get("GOOGLE_SA_KEY")!);
  const adminEmail = Deno.env.get("GOOGLE_ADMIN_EMAIL")!;
  const now = Math.floor(Date.now() / 1000);

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    sub: adminEmail,         // impersonate an admin who can read reports
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signature = await signRS256(unsigned, sa.private_key);
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function signRS256(input: string, pem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return b64urlBytes(new Uint8Array(sig));
}

function pemToBytes(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "")
                  .replace(/-----END PRIVATE KEY-----/, "")
                  .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlBytes = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function yesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
