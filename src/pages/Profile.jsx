import React, { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { leaveBalance, monthsOfService } from "./lib/policy";
import { card, h1, h2, note, label, input, btnPrimary, mono, tag, tagSoft, pills, field } from "./ui";

/* ProfileView — self-service profile. Anyone can edit their own name / role /
   department / schedule; profiles_update RLS already allows id = auth.uid().
   Props: me, leaves, saveProfile(patch)=>bool, flash(msg). */

const DEPTS = ["Founders' Office", "Strategy", "Tech", "Sales & Ops", "Marketing"];

export default function ProfileView({ me, leaves, saveProfile, flash }) {
  const [f, setF] = useState({ name: me.name || "", role: me.role || "", dept: me.dept || DEPTS[0], schedule: me.schedule || "standard" });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    setF({ name: me.name || "", role: me.role || "", dept: me.dept || DEPTS[0], schedule: me.schedule || "standard" });
  }, [me.name, me.role, me.dept, me.schedule]); // eslint-disable-line

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setSavedAt(false); };
  const dirty = f.name !== (me.name || "") || f.role !== (me.role || "") || f.dept !== (me.dept || "") || f.schedule !== (me.schedule || "standard");
  const valid = f.name.trim().length > 0;
  const initials = (me.name || me.email || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const bal = leaveBalance(me.id, leaves);
  const months = monthsOfService(me.join_date);

  const onSave = async () => {
    if (!valid || !dirty) return;
    setSaving(true);
    const ok = await saveProfile({ name: f.name.trim(), role: f.role.trim(), dept: f.dept, schedule: f.schedule });
    setSaving(false);
    if (ok) { setSavedAt(true); flash && flash("Profile updated"); }
  };

  const Field = ({ lbl, children }) => <label className={field}><span className={label}>{lbl}</span>{children}</label>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3.5 flex-wrap"><h1 className={h1}>Your profile</h1></div>

      <section className={card}>
        <div className="flex items-center gap-[18px]">
          <div className="w-16 h-16 rounded-full shrink-0 flex items-center justify-center font-display font-semibold text-[26px] text-white bg-teal tracking-[-1px] shadow-soft">{initials}</div>
          <div className="flex flex-col gap-[3px] min-w-0">
            <span className="font-display font-semibold text-[24px] tracking-[-0.4px] leading-[1.1]">{me.name || "Unnamed"}</span>
            <span className="text-[13px] text-soft font-mono break-all">{me.email}</span>
            <div className="flex gap-2 flex-wrap mt-1">
              <span className={tag}>{me.schedule === "sales-ops" ? "Wed–Sun" : "Mon–Fri"}</span>
              <span className={tagSoft}>{months} mo of service</span>
              {me.is_admin && <span className={pills.ink}>Admin</span>}
            </div>
          </div>
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>Edit details</h2>
        <p className={note}>These show across the console — on the dashboard, the team roster, and leave records. Department and schedule affect your weekly-off days and leave checks.</p>

        <Field lbl="Full name"><input className={input} value={f.name} onChange={set("name")} placeholder="Your name" /></Field>

        <div className="grid grid-cols-2 gap-3 mt-3.5 max-[680px]:grid-cols-1">
          <Field lbl="Job role"><input className={input} value={f.role} onChange={set("role")} placeholder="e.g. Product Designer" /></Field>
          <Field lbl="Department">
            <select className={input} value={f.dept} onChange={set("dept")}>
              {DEPTS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
        </div>

        <div className="mt-3.5">
          <Field lbl="Schedule">
            <select className={input} value={f.schedule} onChange={set("schedule")}>
              <option value="standard">Mon–Fri (off Sat/Sun)</option>
              <option value="sales-ops">Wed–Sun (off Tue/Thu)</option>
            </select>
          </Field>
        </div>

        <div className="flex justify-end items-center gap-2.5 mt-[18px]">
          {savedAt && !dirty && <span className="inline-flex items-center gap-1.5 text-[12.5px] text-grn mr-auto"><Check size={14} /> Saved</span>}
          <button className={btnPrimary} disabled={!valid || !dirty || saving} onClick={onSave}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>Your leave this year</h2>
        <div className="grid grid-cols-3 gap-3.5 max-[680px]:grid-cols-1">
          <Balance label="Privilege" data={bal.PL} note={months < 12 ? "after 1 yr" : null} />
          <Balance label="Sick" data={bal.SL} />
          <Balance label="Casual" data={bal.CL} />
        </div>
      </section>
    </div>
  );
}

function Balance({ label, data, note }) {
  const pct = Math.max(0, Math.min(100, (data.used / data.total) * 100));
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-xs text-soft font-medium">{label}{note && <em className="not-italic text-amber text-[10.5px]"> · {note}</em>}</span>
        <span className={`${mono} font-semibold text-[15px]`}>{data.left}<span className="text-soft text-[11px]">/{data.total}</span></span>
      </div>
      <div className="h-[7px] bg-panel2 rounded overflow-hidden"><div className="h-full bg-teal rounded transition-[width] duration-[400ms]" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}