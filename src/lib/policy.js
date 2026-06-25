// ---------------------------------------------------------------------------
// policy.js — Hoppity Attendance, Leave & Work Culture rules, as pure functions.
// No React, no Supabase. Encodes the company policy document so the rules live
// in one auditable place. Import from views and from the edge function.
// ---------------------------------------------------------------------------

export const ENTITLEMENT = { PL: 14, SL: 6, CL: 7 }; // 27 annual working days
export const WORK_START = "11:00";
export const WORK_END = "18:00";
export const LATE_AFTER_MIN = 11 * 60 + 15; // 11:15 grace
export const FULL_DAY_HOURS = 7;
export const ALLOWED_DOMAIN = "triffair.com";
export const WORK_MODES = ["office", "coworking", "home", "travelling"];

// ---- date helpers (local time, IST-safe: never use toISOString for date keys) ----
export const dKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
export const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const todayKey = () => dKey(new Date());
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const longDate = (d) => d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// Standard team is off Sat/Sun; Sales & Ops (proposed Wed–Sun) is off Tue/Thu.
export const weeklyOff = (schedule) => (schedule === "sales-ops" ? [2, 4] : [0, 6]);

export const monthsOfService = (joinStr) => {
  if (!joinStr) return 0;
  const j = parseDate(joinStr); const n = new Date();
  return (n.getFullYear() - j.getFullYear()) * 12 + (n.getMonth() - j.getMonth()) - (n.getDate() < j.getDate() ? 1 : 0);
};

// Financial year runs April–March.
export const fyStartYear = () => { const n = new Date(); return n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; };
export const fyLabel = () => { const y = fyStartYear(); return `FY ${y}\u2013${String(y + 1).slice(2)}`; };
export const inCurrentFY = (dateStr) => {
  const s = parseDate(`${fyStartYear()}-04-01`); const e = parseDate(`${fyStartYear() + 1}-03-31`);
  const d = parseDate(dateStr); return d >= s && d <= e;
};

export const minutesOf = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
export const hhmm = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
export const hoursBetween = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 3.6e6);

export const isWorkingDay = (schedule, d, holidaySet) => {
  if (weeklyOff(schedule).includes(d.getDay())) return false;
  if (holidaySet.has(dKey(d))) return false;
  return true;
};

export const workingDaysBetween = (schedule, fromExclusive, toExclusive, holidaySet) => {
  let count = 0; let cur = addDays(fromExclusive, 1);
  while (cur < toExclusive) { if (isWorkingDay(schedule, cur, holidaySet)) count++; cur = addDays(cur, 1); }
  return count;
};

// Leave balance for an employee across the current financial year.
export function leaveBalance(empId, leaves) {
  const used = { PL: 0, SL: 0, CL: 0 };
  leaves.forEach((l) => {
    if (l.employee_id === empId && l.status === "approved" && inCurrentFY(l.start_date)) used[l.type] += l.days;
  });
  const mk = (t) => ({ used: used[t], total: ENTITLEMENT[t], left: ENTITLEMENT[t] - used[t] });
  return { PL: mk("PL"), SL: mk("SL"), CL: mk("CL") };
}

// Status of one employee on one date, given attendance + leave + holidays.
export function dayStatus(emp, dateStr, attendanceByKey, holidaySet, holidays, leaves) {
  const d = parseDate(dateStr);
  const rec = attendanceByKey[`${emp.id}__${dateStr}`];
  if (rec?.clock_in) {
    const late = minutesOf(rec.clock_in) > LATE_AFTER_MIN;
    const hrs = rec.clock_out ? hoursBetween(rec.clock_in, rec.clock_out) : null;
    return { kind: "present", rec, late, hrs, short: hrs != null && hrs < FULL_DAY_HOURS };
  }
  if (holidaySet.has(dateStr)) return { kind: "holiday", label: holidays.find((h) => h.date === dateStr)?.name };
  if (weeklyOff(emp.schedule).includes(d.getDay())) return { kind: "off" };
  const lv = leaves.find((l) => l.employee_id === emp.id && l.status === "approved" && dateStr >= l.start_date && dateStr <= l.end_date);
  if (lv) return { kind: "leave", lv };
  if (dateStr < todayKey()) return { kind: "absent" };
  return { kind: "expected" };
}

// Validate a leave request against the policy. Returns { days, advance, errors, warnings, docCert }.
// errors block submission; warnings are allowed through (and recorded) when emergency is set.
export function validateLeave({ emp, type, start, end, emergency, leaves, holidaySet }) {
  if (!emp || !start || !end) return null;
  const s = parseDate(start), e = parseDate(end);
  if (e < s) return { days: 0, errors: ["End date is before start date"], warnings: [] };

  let days = 0;
  if (type === "PL") {
    days = Math.round((e - s) / 8.64e7) + 1; // PL counts calendar days inclusive (weekends/holidays included)
  } else {
    let cur = new Date(s);
    while (cur <= e) { if (isWorkingDay(emp.schedule, cur, holidaySet)) days++; cur = addDays(cur, 1); }
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const advance = workingDaysBetween(emp.schedule, today, s, holidaySet);
  const bal = leaveBalance(emp.id, leaves)[type];
  const months = monthsOfService(emp.join_date);

  const errors = []; const warnings = [];
  if (days <= 0) errors.push("Pick at least one working day");
  if (days > bal.left) errors.push(`Only ${bal.left} ${type} day(s) left this FY`);

  if (type === "CL") {
    if (days > 3) errors.push("CL is capped at 3 days at a time");
    if (!emergency && advance < 5) warnings.push(`CL needs 5 working days notice (got ${advance})`);
    const before = addDays(s, -1), after = addDays(e, 1);
    if (!emergency && (!isWorkingDay(emp.schedule, before, holidaySet) || !isWorkingDay(emp.schedule, after, holidaySet)))
      warnings.push("CL cannot be clubbed with a weekend or holiday");
  }
  if (type === "PL") {
    if (months < 12) errors.push("PL is available only after 1 year of service");
    if (days < 7) errors.push("PL must be at least 7 continuous days");
    if (!emergency && advance < 15) warnings.push(`PL needs 15 working days notice (got ${advance})`);
  }
  if (type === "SL" && days > 3) warnings.push("Doctor's certificate required beyond 3 days");

  return { days, advance, errors, warnings, docCert: type === "SL" && days > 3 };
}
