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

  const loadProfile = useCallback(async (userId) => {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (error) { setError(error.message); return null; }
    return data;
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
    if (session?.user) setProfile(await loadProfile(session.user.id));
    else setProfile(null);
  }

  const signIn = useCallback(async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: { hd: ALLOWED_DOMAIN, prompt: "select_account" }, // hd = hosted-domain hint
        scopes: "email profile",
      },
    });
    if (error) setError(error.message);
  }, []);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);

  const value = { session, profile, loading, error, signIn, signOut, isAdmin: !!profile?.is_admin, refreshProfile: () => session?.user && loadProfile(session.user.id).then(setProfile) };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
