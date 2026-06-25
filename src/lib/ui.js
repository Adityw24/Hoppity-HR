// Shared Tailwind class strings for repeated elements. Importing these keeps
// the utility soup out of every component without a hand-written stylesheet.
export const card = "bg-panel border border-line rounded-card p-[22px] shadow-soft";
export const h1 = "font-display font-semibold text-[30px] tracking-[-0.6px] leading-[1.1] m-0";
export const h2 = "font-display font-semibold text-[20px] tracking-[-0.3px] mb-3.5 mt-0";
export const note = "text-[13px] text-soft leading-relaxed -mt-1.5 mb-4";
export const label = "text-[12.5px] text-soft font-semibold";
export const input = "font-sans text-sm px-3 py-2.5 border border-line2 rounded-lg bg-paper text-ink w-full transition focus:outline-none focus:border-teal focus:ring-[3px] focus:ring-teal-soft";
export const btn = "inline-flex items-center gap-1.5 px-[15px] py-[9px] rounded-lg border border-transparent cursor-pointer font-sans text-[13.5px] font-semibold transition active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed";
export const btnPrimary = `${btn} bg-saffron text-white shadow-soft hover:enabled:bg-saffron-deep`;
export const btnTeal = `${btn} bg-teal text-white hover:enabled:bg-teal-deep`;
export const btnGhost = `${btn} bg-panel text-ink border-line2 hover:bg-panel2`;
export const btnGreen = `${btn} bg-grn-soft text-grn hover:bg-[#d7e9df]`;
export const btnRed = `${btn} bg-red-soft text-red hover:bg-[#f1d8d4]`;
export const icobtn = "bg-transparent border-0 cursor-pointer text-soft p-1.5 rounded-md inline-flex transition hover:bg-panel2 hover:text-ink";
export const mono = "font-mono text-[13px]";
export const tag = "font-mono text-[11px] bg-panel2 px-2 py-[3px] rounded-md text-ink2";
export const tagSoft = "font-mono text-[11px] text-soft";
export const field = "flex flex-col gap-1.5";

// pills
export const pill = "text-[11.5px] font-semibold px-[11px] py-1 rounded-full whitespace-nowrap";
export const pills = {
  green: `${pill} bg-grn-soft text-grn`,
  amber: `${pill} bg-amber-soft text-amber`,
  red: `${pill} bg-red-soft text-red`,
  ink: `${pill} bg-teal-soft text-teal`,
  soft: `${pill} bg-panel2 text-soft`,
  hol: `${pill} bg-purple-soft text-purple`,
};
export const flag = "font-mono text-[10px] text-red bg-red-soft px-1.5 py-0.5 rounded uppercase tracking-[0.04em]";