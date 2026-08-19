import React, { useState, useEffect, useCallback, useMemo } from "react";
import { BrowserRouter, Routes, Route, Navigate, NavLink } from "react-router-dom";
import { Clock, Users, CalendarDays, LayoutDashboard, FileText, Activity, LogOut, UserCog } from "lucide-react";
import { supabase, configError } from "./lib/supabase";
import { useAuth } from "./lib/useAuth";
import { todayKey } from "./lib/policy";
import { ClockView, TeamView, LeaveView, CredibilityView, PolicyView,
  EmployeeModal, LeaveModal, HolidayModal } from "./views";
import { Dashboard } from "./pages/Dashboard";

export default function App() {
  // Router wraps everything so NavLink/Routes/Navigate work even on the
  // pre-console screens. Auth gating still happens in AppInner.
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}

function AppInner() {
  const { loading, session, profile, error, signIn, signOut, isAdmin, refreshProfile } = useAuth();

  if (configError) return <Screen><div className="hp-loading">{configError}</div></Screen>;
  if (loading) return <Screen><div className="hp-loading">Loading the Hoppity console…</div></Screen>;
  if (!session) return <SignIn onSignIn={signIn} error={error} />;
  if (!profile) return <Screen><div className="hp-loading">Setting up your profile… if this hangs, an admin needs to add you.</div></Screen>;

  return <Console {...{ profile, isAdmin, signOut, refreshProfile }} />;
}

function Screen({ children }) {
  return <div className="hp-root"><div className="hp-main">{children}</div></div>;
}

function SignIn({ onSignIn, error }) {
  return (
    <div className="hp-root hp-signin">
      <div className="hp-signin-card">
        <span className="hp-logo">Hoppity</span>
        <h1 className="hp-signin-h1">Attendance &amp; Team Console</h1>
        <p className="hp-signin-sub">Sign in with your Triffair Google account.</p>
        <button className="hp-btn hp-btn-primary hp-signin-btn" onClick={onSignIn}>
          Continue with Google
        </button>
        {error && <p className="hp-signin-err">{error}</p>}
        <p className="hp-signin-note">Access is limited to @triffair.com accounts.</p>
      </div>
    </div>
  );
}

function Console({ profile, isAdmin, signOut, refreshProfile }) {
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState(null);
  const [empModal, setEmpModal] = useState(null);
  const [leaveModal, setLeaveModal] = useState(false);
  const [holModal, setHolModal] = useState(false);

  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState({}); // empId__date -> row
  const [presence, setPresence] = useState({}); // empId__date -> { clocked_in, clocked_out, work_mode } (booleans only; no times)
  const [leaves, setLeaves] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [signals, setSignals] = useState([]); // activity_signals rows
  const [plans, setPlans] = useState([]); // daily_plan rows
  const [busy, setBusy] = useState(true);

  const flash = useCallback((m) => { setToast(m); setTimeout(() => setToast(null), 2600); }, []);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const loadAll = useCallback(async () => {
    setBusy(true);
    const from = todayKey(); // load a window; widen if you need history in the UI
    const [emp, att, lv, hol, sig, pl, pres] = await Promise.all([
      supabase.from("profiles").select("*").eq("active", true).order("name"),
      supabase.from("attendance").select("*").gte("date", addDaysStr(from, -45)),
      supabase.from("leave_requests").select("*").order("applied_on", { ascending: false }),
      supabase.from("holidays").select("*").order("date"),
      supabase.from("activity_signals").select("*").gte("date", addDaysStr(from, -14)),
      supabase.from("daily_plan").select("*").gte("date", addDaysStr(from, -14)),
      // Booleans-only presence feed — readable for the whole team, exposes no times.
      // RLS on `attendance` hides other people's raw rows; this view fills that gap.
      supabase.from("attendance_presence").select("*").gte("date", addDaysStr(from, -45)),
    ]);
    console.log("presence rows:", pres.error || (pres.data || []).length);
    console.log("employees fetched:", (emp.data || []).length,
                (emp.data || []).map((e) => e.id));
    console.log("presence ids:", (pres.data || []).map((r) => r.employee_id));
    setEmployees(emp.data || []);
    const map = {}; (att.data || []).forEach((r) => { map[`${r.employee_id}__${r.date}`] = r; });
    setAttendance(map);
    const pmap = {}; (pres.data || []).forEach((r) => { pmap[`${r.employee_id}__${r.date}`] = r; });
    setPresence(pmap);
    setLeaves(lv.data || []);
    setHolidays(hol.data || []);
    setSignals(sig.data || []);
    setPlans(pl.data || []);
    setBusy(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ---- attendance ----
  const clockIn = async (workMode) => {
    const key = `${profile.id}__${todayKey()}`;
    if (attendance[key]?.clock_in) return;
    const row = { employee_id: profile.id, date: todayKey(), clock_in: new Date().toISOString(), work_mode: workMode };
    const { data, error } = await supabase.from("attendance").upsert(row, { onConflict: "employee_id,date" }).select().single();
    if (error) return flash("Could not clock in");
    setAttendance({ ...attendance, [key]: data }); flash("Clocked in");
  };
  const clockOut = async () => {
    const key = `${profile.id}__${todayKey()}`;
    const rec = attendance[key];
    if (!rec?.clock_in || rec.clock_out) return;
    const { data, error } = await supabase.from("attendance").update({ clock_out: new Date().toISOString() }).eq("id", rec.id).select().single();
    if (error) return flash("Could not clock out");
    setAttendance({ ...attendance, [key]: data }); flash("Clocked out");
  };

  // ---- leave ----
  const submitLeave = async (req) => {
    const row = { employee_id: req.employee_id, type: req.type, start_date: req.start, end_date: req.end,
      days: req.days, reason: req.reason, emergency: req.emergency, doc_cert: req.docCert,
      warnings: req.warnings, status: "pending", applied_on: todayKey() };
    const { data, error } = await supabase.from("leave_requests").insert(row).select().single();
    if (error) return flash("Could not submit");
    setLeaves([data, ...leaves]); setLeaveModal(false); flash("Leave request submitted");
  };
  const decideLeave = async (id, status) => {
    const { data, error } = await supabase.from("leave_requests").update({ status, decided_by: profile.id }).eq("id", id).select().single();
    if (error) return flash("Not allowed");
    setLeaves(leaves.map((l) => (l.id === id ? data : l))); flash(status === "approved" ? "Approved" : "Declined");
  };
  const deleteLeave = async (id) => {
    const { error } = await supabase.from("leave_requests").delete().eq("id", id);
    if (error) return flash("Not allowed");
    setLeaves(leaves.filter((l) => l.id !== id));
  };

  // ---- employees ----
  // saveEmployee handles three cases through the one EmployeeModal:
  //   1. Admin inviting a new member          -> writes pending_invites
  //   2. Admin editing an existing member      -> updates that profiles row
  //   3. A member editing THEIR OWN profile    -> updates their own row
  // Cases 2 and 3 are the same UPDATE; RLS allows it when id = auth.uid()
  // (your own row) OR public.is_admin() (anyone's), so no special path needed.
  const saveEmployee = async (emp) => {
    const payload = { name: emp.name, role: emp.role, dept: emp.dept, join_date: emp.join_date, schedule: emp.schedule };
    if (emp.id) {
      const { data, error } = await supabase.from("profiles").update(payload).eq("id", emp.id).select().single();
      if (error) return flash("Could not save");
      setEmployees((prev) => prev.some((e) => e.id === data.id) ? prev.map((e) => (e.id === data.id ? data : e)) : [...prev, data]);
      if (emp.id === profile.id) refreshProfile?.(); // keep header/me in sync on self-edit
      flash("Saved");
    } else {
      // Admin pre-registers someone before their first login (matched by email on signup).
      const { data, error } = await supabase.from("pending_invites").upsert({ email: emp.email, ...payload }, { onConflict: "email" }).select().single();
      if (error) return flash("Could not invite");
      flash("Invite saved. They'll appear once they sign in.");
    }
    setEmpModal(null);
  };
  const archiveEmployee = async (id) => {
    const { error } = await supabase.from("profiles").update({ active: false }).eq("id", id);
    if (error) return flash("Not allowed");
    setEmployees(employees.filter((e) => e.id !== id)); flash("Archived");
  };

  // ---- holidays (admin) ----
  const addHoliday = async (date, name) => {
    const { error } = await supabase.from("holidays").upsert({ date, name });
    if (error) return flash("Not allowed");
    setHolidays([...holidays, { date, name }].sort((a, b) => a.date.localeCompare(b.date))); setHolModal(false);
  };
  const removeHoliday = async (date) => {
    const { error } = await supabase.from("holidays").delete().eq("date", date);
    if (error) return flash("Not allowed");
    setHolidays(holidays.filter((h) => h.date !== date));
  };

  const me = useMemo(() => employees.find((e) => e.id === profile.id) || profile, [employees, profile]);

  // Open the existing EmployeeModal on the current user's own row.
  const editMyProfile = () => setEmpModal(me);

  const nav = [
    { to: "/dashboard", label: "Today", icon: LayoutDashboard },
    { to: "/clock", label: "Clock", icon: Clock },
    { to: "/credibility", label: "Signals", icon: Activity },
    { to: "/team", label: "Team", icon: Users },
    { to: "/leave", label: "Leave", icon: CalendarDays },
    { to: "/policy", label: "Policy", icon: FileText },
  ];

  const shared = { employees, attendance, presence, leaves, holidays, signals, plans, isAdmin, me, profile, flash };

  return (
    <div className="hp-root">
      <header className="hp-header">
        <div className="hp-brand">
          <span className="hp-logo">Hoppity</span>
          <span className="hp-sub">Attendance &amp; Team Console</span>
        </div>
        <div className="hp-headright">
          <div className="hp-clock-mini">
            <span className="hp-time">{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</span>
            <span className="hp-day">{now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span>
          </div>
          <button className="hp-icobtn" title="Edit my profile" onClick={editMyProfile}><UserCog size={18} /></button>
          <button className="hp-icobtn" title={`Sign out (${profile.email})`} onClick={signOut}><LogOut size={18} /></button>
        </div>
      </header>

      <nav className="hp-nav">
        {nav.map((n) => {
          const Icon = n.icon;
          return (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `hp-tab ${isActive ? "is-active" : ""}`}>
              <Icon size={16} strokeWidth={2.2} /> {n.label}
            </NavLink>
          );
        })}
      </nav>

      <main className="hp-main">
        {busy ? <div className="hp-loading">Loading…</div> : (
          <Routes>
            {/* Opening the console (or "/") lands on the dashboard. */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard {...shared} />} />
            <Route path="/clock" element={<ClockView {...shared} now={now} clockIn={clockIn} clockOut={clockOut} />} />
            <Route path="/credibility" element={<CredibilityView {...shared} />} />
            <Route path="/team" element={<TeamView {...shared} setEmpModal={setEmpModal} archiveEmployee={archiveEmployee}
              setHolModal={setHolModal} removeHoliday={removeHoliday} />} />
            <Route path="/leave" element={<LeaveView {...shared} setLeaveModal={setLeaveModal} decideLeave={decideLeave} deleteLeave={deleteLeave} />} />
            <Route path="/policy" element={<PolicyView />} />
            {/* Unknown paths fall back to the dashboard. */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        )}
      </main>

      {empModal !== null && <EmployeeModal emp={empModal} onClose={() => setEmpModal(null)} onSave={saveEmployee} />}
      {leaveModal && <LeaveModal {...shared} onClose={() => setLeaveModal(false)} onSubmit={submitLeave} />}
      {holModal && <HolidayModal onClose={() => setHolModal(false)} onAdd={addHoliday} />}
      {toast && <div className="hp-toast">{toast}</div>}
    </div>
  );
}

function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n);
  const yy = x.getFullYear(), mm = String(x.getMonth() + 1).padStart(2, "0"), dd = String(x.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}