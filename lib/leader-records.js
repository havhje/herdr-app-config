// The leader's records, and the only code that writes them:
// - the jumplist (shared "jumps"): each tab you land on, with the pane you were last on there (nvim's ctrl-o list);
// - the status log (shared "agents.log"): when an agent needed you or finished, newest last (snacks' notifier history);
// - the other buffer (shared "leader.otherBuffer"): the buffer shown before this one (<leader>bb).
// The leader reads them and moves along the jumplist through jumpTo. They are recorded as the bufferline redraws
// (lite-tabs calls record()), because a hidden mod gets no commands and may not redraw, and the leader is hidden
// until opened (AGENTS.md, Mods: "`<mod>.<command>` reaches shown copies only"; a copy "starts the first time it shows").

import { agents, focused, spaces, shared, setShared } from "herdr";

const MAX_JUMPS = 50, MAX_LOG = 200;

// All three, on every redraw of an always-shown mod (or its timer while zen hides it).
export function record() {
  recordBuffer();
  recordJump();
  recordStatus();
}

// The buffer shown at the last record; the first only learns.
let shownBuffer;
function recordBuffer() {
  const now = spaces().find((s) => s.active)?.id;
  if (now && shownBuffer && now !== shownBuffer) setShared("leader.otherBuffer", shownBuffer);
  shownBuffer = now;
}

function recordJump() {
  const f = focused();
  if (!f?.pane || !f.tab) return;
  const j = shared("jumps") ?? { list: [], at: -1 };
  // jumpTo sets `going` before moving: until it lands, the old place isn't a jump.
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

// Moving along the jumplist (<leader>o / <leader>i): point `at` at entry `at` and say we're `going` there, so the
// arrival isn't recorded as a new jump. The caller then focuses its pane.
export function jumpTo(at) {
  const j = shared("jumps");
  setShared("jumps", { ...j, at, going: { tab: j.list[at].tab, until: Date.now() + 1500 } });
}

// What each agent was at the last record; the first only learns. Herdr's raw words, not the shared status rule:
// a snoozed or settled agent reads idle there, and logging that as "finished" would be false.
let last = null;
function recordStatus() {
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
