import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// If the env vars are missing, createClient() throws synchronously at module
// load — which happens before React mounts and leaves the page completely
// blank with only a console error. Detect that case and surface a readable
// message in the page instead of crashing the whole bundle.
export const configError =
  !url || !anonKey
    ? "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env, fill in the values from Supabase (Project Settings > API), and restart the dev server."
    : null;

if (configError) console.error(configError);

// Use harmless placeholders when config is absent so importing this module
// never throws. App.jsx checks `configError` and shows the message instead of
// attempting any auth/data calls.
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anonKey || "placeholder-anon-key",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);
