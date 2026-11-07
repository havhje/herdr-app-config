// Two records the leader reads, kept here because the bufferline is always shown and redraws on every
// focus and status change:
// - the jumplist (shared "jumps"): each tab you land on, with the pane you were last on there (nvim's ctrl-o list);
// - the status log (shared "agents.log"): when an agent needed you or finished, newest last (snacks' notifier history).

import { agents, focused, shared, setShared } from "herdr";

const MAX_JUMPS = 50, MAX_LOG = 200;

export function recordJump() {
  const f = focused();
  if (!f?.pane || !f.tab) return;
  const j = shared("jumps") ?? { list: [], at: -1 };
  // <leader>o / <leader>i set `going` before moving: until it lands, the old place isn't a jump.
  if (j.going) {
    if (f.tab !== j.going.tab && Date.now() < j.going.until) return;
    if (f.tab === j.going.tab) { setShared("jumps", { list: j.list, at: j.at }); return; }
  }
  const cur = j.list[j.at];
  if (cur?.tab === f.tab) {
    if (cur.pane !== f.pane) setShared("jumps", { list: j.list.map((e, i) => (i === j.at ? { ...e, pane: f.pane } : e)), at: j.at });
    return;
  }
  // A new jump drops what was ahead (as nvim does) and any older visit to the same tab.
  const list = [...j.list.slice(0, j.at + 1).filter((e) => e.tab !== f.tab), { space: f.space, tab: f.tab, pane: f.pane }].slice(-MAX_JUMPS);
  setShared("jumps", { list, at: list.length - 1 });
}

// What each agent was at the last render; the first render only learns.
let last = null;
export function recordStatus() {
  const now = agents();
  if (last === null) { last = new Map(now.map((a) => [a.address, a.status])); return; }
  const add = [];
  for (const a of now) {
    const was = last.get(a.address);
    if (was === a.status) continue;
    // Needs you, or finished (done if you weren't looking; working straight to idle if you were).
    const what = a.status === "blocked" ? "blocked" : a.status === "done" || (was === "working" && a.status === "idle") ? "done" : null;
    if (what) add.push({ at: Date.now(), address: a.address, what, who: a.program?.name ?? a.app ?? "agent", space: a.space_name, tab: a.tab_name, title: a.title ?? "" });
  }
  last = new Map(now.map((a) => [a.address, a.status]));
  if (add.length) setShared("agents.log", [...(shared("agents.log") ?? []), ...add].slice(-MAX_LOG));
}
