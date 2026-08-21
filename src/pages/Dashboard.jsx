import React from "react";
import { dayStatus, todayKey, longDate } from "../lib/policy";
import { StatusBadge } from "../views";

const holSet = (holidays) => new Set(holidays.map((h) => h.date));

/* ============================= DASHBOARD ============================= */
export function Dashboard({ employees, attendance, leaves, holidays, presence = {}, isAdmin, profile }) {
  const today = todayKey();
  const hs = holSet(holidays);

  ////
console.log("presence keys in Dashboard:", Object.keys(presence).length, Object.keys(presence).slice(0, 3));

const statuses = employees.map((e) => {
  let s = dayStatus(e, today, attendance, hs, holidays, leaves);
  const key = `${e.id}__${today}`;
  const p = presence[key];
  console.log(e.name, "| kind:", s.kind, "| key:", key, "| hasPresence:", !!p, "| clocked_in:", p?.clocked_in, "| mode:", p?.work_mode);

  if (!["leave", "holiday", "off", "present"].includes(s.kind)) {
    if (p?.clocked_in) {
      s = {
        kind: "present",
        presenceOnly: true,
        rec: { clock_in: null, clock_out: p.clocked_out || null, work_mode: p.work_mode },
      };
    }
  }
  return { e, s };
});

  const count = (k) => statuses.filter((x) => x.s.kind === k).length;
  const todayHol = holidays.find((h) => h.date === today)?.name;
  const pending = isAdmin ? leaves.filter((l) => l.status === "pending") : [];

  return (
    <div className="hp-stack">
      <div className="hp-pagehead">
        <h1 className="hp-h1">{longDate(new Date())}</h1>
        {todayHol && <span className="hp-pill hp-pill-hol">Company holiday · {todayHol}</span>}
      </div>
      <div className="hp-stats">
        <Stat n={count("present")} label="Clocked in" tone="green" />
        <Stat n={count("expected")} label="Yet to clock in" tone="amber" />
        <Stat n={count("leave")} label="On leave" tone="ink" />
        <Stat n={count("off") + count("holiday")} label="Off / holiday" tone="soft" />
      </div>
      <section className="hp-card">
        <h2 className="hp-h2">Who's around today</h2>
        <div className="hp-rows">
          {statuses.map(({ e, s }) => (
            <div className="hp-row" key={e.id}>
              <div className="hp-row-main">
                <span className="hp-name">{e.name}{e.id === profile.id && <em className="hp-you"> · you</em>}</span>
                <span className="hp-role">{e.role}</span>
              </div>
              {/* Only you and admins see clock times; everyone else sees status + work mode. */}
              <StatusBadge s={s} revealTimes={false} />
            </div>
          ))}
        </div>
      </section>
      {pending.length > 0 && (
        <section className="hp-card">
          <h2 className="hp-h2">Awaiting approval <span className="hp-count">{pending.length}</span></h2>
          <div className="hp-rows">
            {pending.map((l) => {
              const e = employees.find((x) => x.id === l.employee_id);
              return (
                <div className="hp-row" key={l.id}>
                  <div className="hp-row-main">
                    <span className="hp-name">{e?.name}</span>
                    <span className="hp-role">{l.type} · {l.days}d · {l.start_date} to {l.end_date}</span>
                  </div>
                  <span className="hp-pill hp-pill-amber">Pending</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ n, label, tone }) {
  return <div className={`hp-stat hp-tone-${tone}`}><span className="hp-stat-n">{n}</span><span className="hp-stat-l">{label}</span></div>;
}