import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Clock, Users, CalendarDays, LayoutDashboard, FileText, Activity, LogOut } from "lucide-react";
import { supabase, configError } from "./lib/supabase";
import { useAuth } from "./lib/useAuth";
import { todayKey } from "./lib/policy";
import { Dashboard, ClockView, TeamView, LeaveView, CredibilityView, PolicyView,
  EmployeeModal, LeaveModal, HolidayModal } from "./views";

export default function App() {
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
  const [view, setView] = useState("dashboard");
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState(null);
  const [empModal, setEmpModal] = useState(null);
  const [leaveModal, setLeaveModal] = useState(false);
  const [holModal, setHolModal] = useState(false);

  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState({}); // empId__date -> row
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
    const [emp, att, lv, hol, sig, pl] = await Promise.all([
      supabase.from("profiles").select("*").eq("active", true).order("name"),
      supabase.from("attendance").select("*").gte("date", addDaysStr(from, -45)),
      supabase.from("leave_requests").select("*").order("applied_on", { ascending: false }),
      supabase.from("holidays").select("*").order("date"),
      supabase.from("activity_signals").select("*").gte("date", addDaysStr(from, -14)),
      supabase.from("daily_plan").select("*").gte("date", addDaysStr(from, -14)),
    ]);
    setEmployees(emp.data || []);
    const map = {}; (att.data || []).forEach((r) => { map[`${r.employee_id}__${r.date}`] = r; });
    setAttendance(map);
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

  // ---- employees (admin) ----
  const saveEmployee = async (emp) => {
    const payload = { name: emp.name, role: emp.role, dept: emp.dept, join_date: emp.join_date, schedule: emp.schedule };
    if (emp.id) {
      const { data, error } = await supabase.from("profiles").update(payload).eq("id", emp.id).select().single();
      if (error) return flash("Not allowed");
      setEmployees(employees.map((e) => (e.id === emp.id ? data : e)));
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

  const nav = [
    { id: "dashboard", label: "Today", icon: LayoutDashboard },
    { id: "clock", label: "Clock", icon: Clock },
    { id: "credibility", label: "Signals", icon: Activity },
    { id: "team", label: "Team", icon: Users },
    { id: "leave", label: "Leave", icon: CalendarDays },
    { id: "policy", label: "Policy", icon: FileText },
  ];

  const shared = { employees, attendance, leaves, holidays, signals, plans, isAdmin, me, profile, flash };

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
          <button className="hp-icobtn" title={`Sign out (${profile.email})`} onClick={signOut}><LogOut size={18} /></button>
        </div>
      </header>

      <nav className="hp-nav">
        {nav.map((n) => {
          const Icon = n.icon;
          return (
            <button key={n.id} className={`hp-tab ${view === n.id ? "is-active" : ""}`} onClick={() => setView(n.id)}>
              <Icon size={16} strokeWidth={2.2} /> {n.label}
            </button>
          );
        })}
      </nav>

      <main className="hp-main">
        {busy ? <div className="hp-loading">Loading…</div> : (
          <>
            {view === "dashboard" && <Dashboard {...shared} />}
            {view === "clock" && <ClockView {...shared} now={now} clockIn={clockIn} clockOut={clockOut} />}
            {view === "credibility" && <CredibilityView {...shared} />}
            {view === "team" && <TeamView {...shared} setEmpModal={setEmpModal} archiveEmployee={archiveEmployee}
              setHolModal={setHolModal} removeHoliday={removeHoliday} />}
            {view === "leave" && <LeaveView {...shared} setLeaveModal={setLeaveModal} decideLeave={decideLeave} deleteLeave={deleteLeave} />}
            {view === "policy" && <PolicyView />}
          </>
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
