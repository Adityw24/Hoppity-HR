import React, { useState, useMemo } from "react";
import {
  LogIn, LogOut, Check, X, Plus, Download, AlertTriangle, Pencil, Trash2,
} from "lucide-react";
import {
  ENTITLEMENT, WORK_START, WORK_END, WORK_MODES, FULL_DAY_HOURS,
  dayStatus, leaveBalance, validateLeave, monthsOfService, fyLabel,
  todayKey, longDate, hhmm, parseDate,
} from "./lib/policy";

const holSet = (holidays) => new Set(holidays.map((h) => h.date));

/* ============================= STATUS BADGE (shared) ============================= */
// Used by Dashboard.jsx and CredibilityView. revealTimes gates clock-in/out times,
// late/short flags — everything that would expose *when* someone clocked in. Status
// (In/Done) and work mode always show. Non-admins pass revealTimes=false for other
// people; it defaults to true so CredibilityView (self / admin-only data) is unaffected.
export function StatusBadge({ s, revealTimes = true }) {
  if (s.kind === "present") {
    return (
      <div className="hp-statusline">
        <span className="hp-pill hp-pill-green">{s.rec.clock_out ? "Done" : "In"}</span>
        {s.rec.work_mode && <span className="hp-tag">{s.rec.work_mode}</span>}
        {revealTimes && s.rec.clock_in && (
          <span className="hp-mono">{hhmm(s.rec.clock_in)}{s.rec.clock_out ? ` → ${hhmm(s.rec.clock_out)}` : ""}</span>
        )}
        {revealTimes && s.late && <span className="hp-flag">late</span>}
        {revealTimes && s.short && <span className="hp-flag">short</span>}
      </div>
    );
  }
  if (s.kind === "leave") return <span className="hp-pill hp-pill-ink">{s.lv.type} leave</span>;
  if (s.kind === "holiday") return <span className="hp-pill hp-pill-hol">Holiday</span>;
  if (s.kind === "off") return <span className="hp-pill hp-pill-soft">Weekly off</span>;
  if (s.kind === "absent") return <span className="hp-pill hp-pill-red">Absent</span>;
  return <span className="hp-pill hp-pill-amber">Not in yet</span>;
}

/* ============================= CLOCK ============================= */
export function ClockView({ me, attendance, holidays, leaves, now, clockIn, clockOut }) {
  const [mode, setMode] = useState(WORK_MODES[0]);
  const today = todayKey();
  const s = dayStatus(me, today, attendance, holSet(holidays), holidays, leaves);
  const rec = s.kind === "present" ? s.rec : null;
  const blocked = ["holiday", "off"].includes(s.kind);

  return (
    <div className="hp-stack">
      <div className="hp-bigclock">
        <span className="hp-bigtime">{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}</span>
        <span className="hp-bigday">{longDate(now)}</span>
        <span className="hp-window">Work window {WORK_START}–{WORK_END} · 7 hrs incl. lunch · grace till 11:15</span>
      </div>

      <section className="hp-card">
        <h2 className="hp-h2">Your day</h2>
        <p className="hp-note">Attendance recorded here is the source of truth for payroll. No entry means absent for the day.</p>

        {!rec && !blocked && s.kind !== "leave" && (
          <>
            <div className="hp-field">
              <span className="hp-field-label">Where are you working from?</span>
              <div className="hp-modes">
                {WORK_MODES.map((m) => (
                  <button key={m} className={`hp-chip ${mode === m ? "is-active" : ""}`} onClick={() => setMode(m)}>{m}</button>
                ))}
              </div>
            </div>
            <button className="hp-btn hp-btn-primary hp-btn-lg" onClick={() => clockIn(mode)}><LogIn size={16} /> Clock in</button>
          </>
        )}

        {rec && (
          <div className="hp-clockcard">
            <div className="hp-clockcard-row"><span>Clocked in</span><span className="hp-mono">{hhmm(rec.clock_in)} {rec.work_mode && `· ${rec.work_mode}`} {s.late && <span className="hp-flag">late</span>}</span></div>
            {rec.clock_out
              ? <div className="hp-clockcard-row"><span>Clocked out</span><span className="hp-mono">{hhmm(rec.clock_out)} {s.hrs != null && <span className="hp-hrs">{s.hrs.toFixed(1)}h</span>} {s.short && <span className="hp-flag">short</span>}</span></div>
              : <button className="hp-btn hp-btn-out hp-btn-lg" onClick={clockOut}><LogOut size={16} /> Clock out</button>}
          </div>
        )}

        {blocked && <span className="hp-pill hp-pill-soft">{s.kind === "holiday" ? `Holiday · ${s.label || ""}` : "Weekly off today"}</span>}
        {s.kind === "leave" && <span className="hp-pill hp-pill-ink">You're on {s.lv.type} leave today</span>}
      </section>
    </div>
  );
}

/* ============================= CREDIBILITY / SIGNALS ============================= */
// The three-legged view: declared mode (attendance) + activity signals (Workspace/GitHub)
// + planned-vs-done (daily_plan). Signals are populated by the sync edge function.
export function CredibilityView({ employees, attendance, signals, plans, isAdmin, me, holidays, leaves }) {
  const today = todayKey();
  const hs = holSet(holidays);
  const roster = isAdmin ? employees : [me];

  const signalsFor = (empId, date) => signals.filter((s) => s.employee_id === empId && s.date === date);
  const plansFor = (empId, date) => plans.filter((p) => p.employee_id === empId && p.date === date);

  return (
    <div className="hp-stack">
      <div className="hp-pagehead">
        <h1 className="hp-h1">Credibility signals</h1>
        <span className="hp-fy">{today}</span>
      </div>
      <p className="hp-note">
        Presence is only one leg. Each person's day is read as the agreement between what they declared, what their
        tools show, and what they planned to ship. Signals are pulled daily from Google Workspace and GitHub by the
        sync job — empty here means the job hasn't run yet or the source isn't connected.
      </p>

      <section className="hp-card">
        <div className="hp-rows">
          {roster.map((e) => {
            const s = dayStatus(e, today, attendance, hs, holidays, leaves);
            const sig = signalsFor(e.id, today);
            const pl = plansFor(e.id, today);
            const done = pl.filter((p) => p.status === "done").length;
            return (
              <div className="hp-cred" key={e.id}>
                <div className="hp-cred-head">
                  <div className="hp-row-main">
                    <span className="hp-name">{e.name}</span>
                    <span className="hp-role">{e.role}</span>
                  </div>
                  <StatusBadge s={s} />
                </div>
                <div className="hp-cred-legs">
                  <Leg label="Declared">{s.kind === "present" ? (s.rec.work_mode || "in") : s.kind}</Leg>
                  <Leg label="Activity">
                    {sig.length === 0 ? <span className="hp-soft">no signal</span> :
                      sig.map((x) => <span key={x.id} className="hp-sigchip">{x.source}: {x.value}</span>)}
                  </Leg>
                  <Leg label="Planned / done">
                    {pl.length === 0 ? <span className="hp-soft">no plan</span> : <span className="hp-mono">{done}/{pl.length}</span>}
                  </Leg>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
function Leg({ label, children }) {
  return <div className="hp-leg"><span className="hp-leg-label">{label}</span><div className="hp-leg-body">{children}</div></div>;
}

/* ============================= TEAM ============================= */
export function TeamView({ employees, leaves, attendance, holidays, isAdmin, setEmpModal, archiveEmployee, setHolModal, removeHoliday }) {
  const exportAttendance = () => {
    const rows = [["Employee", "Date", "Clock In", "Clock Out", "Hours", "Mode", "Status"]];
    Object.values(attendance).forEach((v) => {
      const e = employees.find((x) => x.id === v.employee_id);
      const hrs = v.clock_in && v.clock_out ? ((new Date(v.clock_out) - new Date(v.clock_in)) / 3.6e6).toFixed(2) : "";
      rows.push([e?.name || "?", v.date, v.clock_in ? hhmm(v.clock_in) : "", v.clock_out ? hhmm(v.clock_out) : "", hrs, v.work_mode || "", v.clock_in ? (v.clock_out ? "Complete" : "In progress") : ""]);
    });
    rows.sort((a, b) => (a[1] || "").localeCompare(b[1] || ""));
    downloadCSV(`hoppity-attendance-${todayKey()}.csv`, rows);
  };

  return (
    <div className="hp-stack">
      <div className="hp-pagehead">
        <h1 className="hp-h1">Team <span className="hp-fy">{fyLabel()}</span></h1>
        <div className="hp-actions">
          <button className="hp-btn hp-btn-ghost" onClick={exportAttendance}><Download size={15} /> Attendance CSV</button>
          {isAdmin && <button className="hp-btn hp-btn-primary" onClick={() => setEmpModal({})}><Plus size={15} /> Invite member</button>}
        </div>
      </div>

      <section className="hp-card">
        <div className="hp-rows">
          {employees.map((e) => {
            const bal = leaveBalance(e.id, leaves);
            const months = monthsOfService(e.join_date);
            return (
              <div className="hp-emp" key={e.id}>
                <div className="hp-emp-top">
                  <div className="hp-row-main">
                    <span className="hp-name">{e.name}</span>
                    <span className="hp-role">{e.role} · {e.dept}</span>
                  </div>
                  <div className="hp-emp-meta">
                    <span className="hp-tag">{e.schedule === "sales-ops" ? "Wed–Sun" : "Mon–Fri"}</span>
                    <span className="hp-tag-soft">{months} mo</span>
                    {isAdmin && <button className="hp-icobtn" onClick={() => setEmpModal(e)}><Pencil size={15} /></button>}
                    {isAdmin && <button className="hp-icobtn" onClick={() => archiveEmployee(e.id)}><Trash2 size={15} /></button>}
                  </div>
                </div>
                <div className="hp-balances">
                  <Balance label="Privilege" data={bal.PL} note={months < 12 ? "after 1 yr" : null} />
                  <Balance label="Sick" data={bal.SL} />
                  <Balance label="Casual" data={bal.CL} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="hp-card">
        <div className="hp-pagehead">
          <h2 className="hp-h2">Public holidays <span className="hp-count">{holidays.length}</span></h2>
          {isAdmin && <button className="hp-btn hp-btn-ghost" onClick={() => setHolModal(true)}><Plus size={15} /> Add holiday</button>}
        </div>
        <p className="hp-note">12 festival holidays + 2 national days per year. Festival dates are company-set.</p>
        <div className="hp-hol-grid">
          {holidays.map((h) => (
            <div className="hp-hol" key={h.date}>
              <span className="hp-mono">{h.date}</span>
              <span className="hp-hol-name">{h.name}</span>
              {isAdmin && <button className="hp-icobtn" onClick={() => removeHoliday(h.date)}><X size={14} /></button>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Balance({ label, data, note }) {
  const pct = Math.max(0, Math.min(100, (data.used / data.total) * 100));
  return (
    <div className="hp-bal">
      <div className="hp-bal-head">
        <span className="hp-bal-label">{label}{note && <em className="hp-bal-note"> · {note}</em>}</span>
        <span className="hp-mono hp-bal-num">{data.left}<span className="hp-bal-tot">/{data.total}</span></span>
      </div>
      <div className="hp-bar"><div className="hp-bar-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/* ============================= LEAVE ============================= */
export function LeaveView({ employees, leaves, isAdmin, profile, setLeaveModal, decideLeave, deleteLeave }) {
  const [filter, setFilter] = useState("all");
  const mine = isAdmin ? leaves : leaves.filter((l) => l.employee_id === profile.id);
  const list = mine.filter((l) => filter === "all" || l.status === filter);
  const exportLeaves = () => {
    const rows = [["Employee", "Type", "From", "To", "Days", "Status", "Applied", "Reason"]];
    mine.forEach((l) => {
      const e = employees.find((x) => x.id === l.employee_id);
      rows.push([e?.name || "?", l.type, l.start_date, l.end_date, l.days, l.status, l.applied_on, (l.reason || "")]);
    });
    downloadCSV(`hoppity-leaves-${todayKey()}.csv`, rows);
  };

  return (
    <div className="hp-stack">
      <div className="hp-pagehead">
        <h1 className="hp-h1">Leave ledger</h1>
        <div className="hp-actions">
          <button className="hp-btn hp-btn-ghost" onClick={exportLeaves}><Download size={15} /> Ledger CSV</button>
          <button className="hp-btn hp-btn-primary" onClick={() => setLeaveModal(true)}><Plus size={15} /> Apply for leave</button>
        </div>
      </div>
      <div className="hp-filters">
        {["all", "pending", "approved", "rejected"].map((f) => (
          <button key={f} className={`hp-chip ${filter === f ? "is-active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <section className="hp-card">
        {list.length === 0 ? <p className="hp-empty">No requests here yet.</p> : (
          <div className="hp-rows">
            {list.map((l) => {
              const e = employees.find((x) => x.id === l.employee_id);
              const canDecide = isAdmin && l.status === "pending";
              return (
                <div className="hp-leave" key={l.id}>
                  <div className="hp-row-main">
                    <span className="hp-name">{e?.name}</span>
                    <span className="hp-role">
                      <strong className="hp-lt">{l.type}</strong> · {l.days} day{l.days > 1 ? "s" : ""} · {l.start_date} → {l.end_date}
                      {l.emergency && <span className="hp-flag">emergency</span>}
                      {l.doc_cert && <span className="hp-flag">med cert</span>}
                    </span>
                    {l.reason && <span className="hp-reason">{l.reason}</span>}
                    {l.warnings?.length > 0 && <span className="hp-warn"><AlertTriangle size={13} /> {l.warnings.join(" · ")}</span>}
                  </div>
                  <div className="hp-leave-actions">
                    {canDecide ? (
                      <>
                        <button className="hp-btn hp-btn-green" onClick={() => decideLeave(l.id, "approved")}><Check size={15} /> Approve</button>
                        <button className="hp-btn hp-btn-red" onClick={() => decideLeave(l.id, "rejected")}><X size={15} /> Decline</button>
                      </>
                    ) : <span className={`hp-pill ${l.status === "approved" ? "hp-pill-green" : l.status === "rejected" ? "hp-pill-red" : "hp-pill-amber"}`}>{l.status}</span>}
                    {(isAdmin || l.employee_id === profile.id) && <button className="hp-icobtn" onClick={() => deleteLeave(l.id)}><Trash2 size={14} /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* ============================= POLICY ============================= */
export function PolicyView() {
  return (
    <div className="hp-stack">
      <h1 className="hp-h1">Policy at a glance</h1>
      <div className="hp-policy-grid">
        <PolicyCard title="Annual leave — 27 working days">
          <Rule k="14 Privilege (PL)" v="Long planned absences. Min 7 continuous days; weekends/holidays in between count. Apply 15 working days ahead. After 1 year of service; pro-rata for part-year." />
          <Rule k="06 Sick (SL)" v="Doctor's certificate required beyond 3 continuous days." />
          <Rule k="07 Casual (CL)" v="Emergencies and one-offs. Max 3 days at a time. Apply 5 working days ahead. No clubbing with a weekend." />
        </PolicyCard>
        <PolicyCard title="Public holidays — 14">
          <Rule k="12 festivals" v="Set by the company at the start of the year, or chosen by staff per their faith." />
          <Rule k="2 national" v="Independence Day and Republic Day." />
        </PolicyCard>
        <PolicyCard title="Working hours">
          <Rule k="Standard" v="Mon–Fri, 11:00–18:00. Off Sat & Sun." />
          <Rule k="Sales & Ops" v="Wed–Sun, 11:00–18:00. Off Tue & Thu — to cover weekend client activity." />
          <Rule k="The day" v="7 hours including lunch. Clock in/out in the app; no entry reads as absent for payroll." />
        </PolicyCard>
        <PolicyCard title="Emergencies">
          <Rule k="What counts" v="Medical crises, accidents, severe family emergencies." />
          <Rule k="Protocol" v="Notify your team head at least 2 hours before your day begins, or as soon as safely possible." />
          <Rule k="Abuse" v="Repeated last-minute 'emergencies' without valid reason trigger a performance and compliance review." />
        </PolicyCard>
      </div>
      <p className="hp-note">The console applies these as live checks at request time. Day-counting: PL counts calendar days inclusive; SL and CL count working days only.</p>
    </div>
  );
}
function PolicyCard({ title, children }) { return <section className="hp-card hp-policy-card"><h2 className="hp-h2">{title}</h2><div className="hp-rules">{children}</div></section>; }
function Rule({ k, v }) { return <div className="hp-rule"><span className="hp-rule-k">{k}</span><span className="hp-rule-v">{v}</span></div>; }

/* ============================= MODALS ============================= */
export function EmployeeModal({ emp, onClose, onSave }) {
  const isNew = !emp.id;
  const [f, setF] = useState({
    id: emp.id, email: emp.email || "", name: emp.name || "", role: emp.role || "",
    dept: emp.dept || "Founders' Office", join_date: emp.join_date || todayKey(), schedule: emp.schedule || "standard",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = f.name.trim() && f.role.trim() && (!isNew || /@triffair\.com$/.test(f.email.trim()));
  return (
    <Modal onClose={onClose} title={isNew ? "Invite member" : "Edit member"}>
      {isNew && <Field label="Triffair email"><input className="hp-input" value={f.email} onChange={set("email")} placeholder="name@triffair.com" /></Field>}
      <Field label="Full name"><input className="hp-input" value={f.name} onChange={set("name")} /></Field>
      <Field label="Role"><input className="hp-input" value={f.role} onChange={set("role")} /></Field>
      <Field label="Department">
        <select className="hp-input" value={f.dept} onChange={set("dept")}>
          {["Founders' Office", "Strategy", "Tech", "Sales & Ops", "Marketing"].map((d) => <option key={d}>{d}</option>)}
        </select>
      </Field>
      <div className="hp-two">
        <Field label="Joining date"><input type="date" className="hp-input" value={f.join_date} onChange={set("join_date")} /></Field>
        <Field label="Schedule">
          <select className="hp-input" value={f.schedule} onChange={set("schedule")}>
            <option value="standard">Mon–Fri (off Sat/Sun)</option>
            <option value="sales-ops">Wed–Sun (off Tue/Thu)</option>
          </select>
        </Field>
      </div>
      <div className="hp-modal-actions">
        <button className="hp-btn hp-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="hp-btn hp-btn-primary" disabled={!valid} onClick={() => onSave(f)}>Save</button>
      </div>
    </Modal>
  );
}

export function LeaveModal({ employees, leaves, holidays, isAdmin, profile, onClose, onSubmit }) {
  const selectable = isAdmin ? employees : employees.filter((e) => e.id === profile.id);
  const [empId, setEmpId] = useState(profile.id);
  const [type, setType] = useState("CL");
  const [start, setStart] = useState(todayKey());
  const [end, setEnd] = useState(todayKey());
  const [reason, setReason] = useState("");
  const [emergency, setEmergency] = useState(false);
  const emp = employees.find((e) => e.id === empId);
  const hs = holSet(holidays);
  const check = useMemo(() => validateLeave({ emp, type, start, end, emergency, leaves, holidaySet: hs }),
    [emp, type, start, end, emergency, leaves, holidays]); // eslint-disable-line
  const canSubmit = check && check.errors.length === 0 && check.days > 0;

  return (
    <Modal onClose={onClose} title="Apply for leave" wide>
      <div className="hp-two">
        <Field label="Member">
          <select className="hp-input" value={empId} onChange={(e) => setEmpId(e.target.value)} disabled={!isAdmin}>
            {selectable.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select className="hp-input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="CL">Casual (CL)</option><option value="SL">Sick (SL)</option><option value="PL">Privilege (PL)</option>
          </select>
        </Field>
      </div>
      <div className="hp-two">
        <Field label="From"><input type="date" className="hp-input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="hp-input" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <Field label="Reason"><input className="hp-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Short note for your manager" /></Field>
      <label className="hp-checkrow">
        <input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} />
        <span>True emergency — waive notice rules (medical, accident, severe family)</span>
      </label>
      {check && (
        <div className="hp-check">
          <div className="hp-check-days"><span className="hp-mono hp-check-n">{check.days}</span> day{check.days !== 1 ? "s" : ""}{check.advance != null && <span className="hp-check-adv"> · {check.advance} working days notice</span>}</div>
          {check.errors.map((x, i) => <div key={i} className="hp-msg hp-msg-err"><X size={13} /> {x}</div>)}
          {check.warnings.map((x, i) => <div key={i} className="hp-msg hp-msg-warn"><AlertTriangle size={13} /> {x}</div>)}
          {check.errors.length === 0 && check.warnings.length === 0 && <div className="hp-msg hp-msg-ok"><Check size={13} /> Meets all policy timelines</div>}
        </div>
      )}
      <div className="hp-modal-actions">
        <button className="hp-btn hp-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="hp-btn hp-btn-primary" disabled={!canSubmit}
          onClick={() => onSubmit({ employee_id: empId, type, start, end, days: check.days, reason, emergency, docCert: check.docCert, warnings: check.warnings })}>
          Submit request
        </button>
      </div>
    </Modal>
  );
}

export function HolidayModal({ onClose, onAdd }) {
  const [date, setDate] = useState(todayKey());
  const [name, setName] = useState("");
  return (
    <Modal onClose={onClose} title="Add public holiday">
      <Field label="Date"><input type="date" className="hp-input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Name"><input className="hp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali" /></Field>
      <div className="hp-modal-actions">
        <button className="hp-btn hp-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="hp-btn hp-btn-primary" disabled={!name.trim()} onClick={() => onAdd(date, name.trim())}>Add</button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div className="hp-overlay" onClick={onClose}>
      <div className={`hp-modal ${wide ? "hp-modal-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="hp-modal-head"><h3 className="hp-modal-title">{title}</h3><button className="hp-icobtn" onClick={onClose}><X size={18} /></button></div>
        <div className="hp-modal-body">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, children }) { return <label className="hp-field"><span className="hp-field-label">{label}</span>{children}</label>; }

/* ---- CSV helper ---- */
function downloadCSV(filename, rows) {
  const text = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, "'")}"`).join(",")).join("\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}