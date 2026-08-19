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

  // Synchronous session gate. This MUST NOT await any supabase call — see the
  // lifecycle effect below for why. Domain rejection signs out (fire-and-forget,
  // which re-enters here with a null session) and keeps the bad session out of state.
  const applyAuthState = useCallback((s) => {
    // Defense-in-depth: the Google app is "Internal" (Workspace-only) and a DB
    // trigger blocks non-triffair signups, but we also refuse here so a stray
    // session can never render the app.
    const email = s?.user?.email || "";
    if (s && !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setError(`Use your @${ALLOWED_DOMAIN} account to sign in.`);
      supabase.auth.signOut();   // fire-and-forget; emits SIGNED_OUT → re-enters with null
      setSession(null);
      return;
    }
    setSession(s);
  }, []);

  // ---- auth lifecycle ----
  // The reload hang came from AWAITING supabase calls inside onAuthStateChange.
  // That callback runs while supabase-js holds its internal auth lock; the old
  // code awaited loadOrCreateProfile there, which calls supabase.from(...), which
  // needs the same lock to attach the access token — so it waited on a lock that
  // couldn't release until the callback returned. Deadlock. On a manual refresh
  // the getSession() path (outside the lock) usually won the race first, which is
  // why refreshing "fixed" it. The rule now: keep this callback synchronous and
  // do all profile loading in the separate effect below, outside the lock.
  useEffect(() => {
    let active = true;

    // Persisted session (refresh path) + OAuth-redirect URL processing both
    // resolve here. Clear loading in .finally so a rejection can't hang the gate.
    supabase.auth.getSession()
      .then(({ data }) => { if (active) applyAuthState(data.session); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!active) return;
      applyAuthState(s);
      setLoading(false);   // clear on the first signal from either source
    });

    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [applyAuthState]);

  // Profile loading reacts to session changes and runs OUTSIDE the auth lock, so
  // its supabase.from(...) calls are free to acquire the token normally. Keyed on
  // the user id so a routine token refresh (same user, new session object) doesn't
  // needlessly refetch or momentarily wipe the profile.
  useEffect(() => {
    let active = true;
    const user = session?.user;
    if (!user) { setProfile(null); return; }
    loadOrCreateProfile(user).then((p) => { if (active) setProfile(p); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

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