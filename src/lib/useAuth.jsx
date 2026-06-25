import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";
import { ALLOWED_DOMAIN } from "./policy";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load the user's profile row; if it doesn't exist yet (first login, or the
  // signup trigger never fired), create it directly from the client. Returns
  // the row so the app can fall through its "no profile" gate and render at "/".
  const loadOrCreateProfile = useCallback(async (user) => {
    // 1) Try to read it. maybeSingle() returns null for zero rows instead of
    //    throwing a 406 the way single() does.
    const { data: existing, error: readErr } = await supabase
      .from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (readErr) { setError(readErr.message); return null; }
    if (existing) return existing;

    // 2) No row yet — create one. Seed sensible values from the Google identity
    //    so name isn't null. The user can refine these later in the edit modal.
    const meta = user.user_metadata || {};
    const seed = {
      id: user.id,
      email: user.email,
      name: meta.full_name || meta.name || user.email.split("@")[0],
      role: "",
      dept: "",
    };
    const { data: created, error: insertErr } = await supabase
      .from("profiles").insert(seed).select().single();

    if (insertErr) {
      // If a concurrent trigger/insert won the race, the row now exists — re-read it.
      if (insertErr.code === "23505") {
        const { data: again } = await supabase
          .from("profiles").select("*").eq("id", user.id).maybeSingle();
        if (again) return again;
      }
      setError(insertErr.message);
      return null;
    }
    return created;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      await applySession(session);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      await applySession(session);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line
  }, []);

  async function applySession(session) {
    // Defense-in-depth: the Google app is "Internal" (Workspace-only) and a DB
    // trigger blocks non-triffair signups, but we also refuse here so a stray
    // session can never render the app.
    const email = session?.user?.email || "";
    if (session && !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setError(`Use your @${ALLOWED_DOMAIN} account to sign in.`);
      await supabase.auth.signOut();
      setSession(null); setProfile(null);
      return;
    }
    setSession(session);
    if (session?.user) setProfile(await loadOrCreateProfile(session.user));
    else setProfile(null);
  }

  const signIn = useCallback(async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin, // lands back on "/"
        queryParams: { hd: ALLOWED_DOMAIN, prompt: "select_account" }, // hd = hosted-domain hint
        scopes: "email profile",
      },
    });
    if (error) setError(error.message);
  }, []);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);

  const value = {
    session, profile, loading, error, signIn, signOut,
    isAdmin: !!profile?.is_admin,
    refreshProfile: () => session?.user && loadOrCreateProfile(session.user).then(setProfile),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}