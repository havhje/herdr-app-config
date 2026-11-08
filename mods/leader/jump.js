// Moving between agents and places, nvim style: the "needs me" queue (]q over blocked and done agents),
// the jumplist (ctrl-o / ctrl-i over tabs you were on), zen mode and killing an agent.
// The jumplist and the status log are kept by leader-records.js (from lib/); this file reads them and moves.

import { agents, panes, run, shared, setShared, notify, openOverlay, layout } from "herdr";
import { needsMeQueue } from "./agent-status.js";
import { jumpTo } from "./leader-records.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

// As agents-list' zoom.js: a zoomed tab draws its zoomed pane whatever is focused, so unzoom onto the target first.
function zoomTo(found) {
  const ps = panes(), p = ps.find(found);
  if (p && !p.zoomed && ps.some((q) => q.tab === p.tab && q.zoomed)) run("pane.zoom", { pane: p.pane });
}
export function focusPane(pane) {
  zoomTo((p) => p.pane === pane);
  run("pane.focus", { pane });
}
// An agent with a pane gets the keyboard; a sub-agent without one opens as a peek.
export function goToAgent(address) {
  if (!panes().some((p) => p.terminal === address)) return run("terminal.peek", { terminal: address });
  zoomTo((p) => p.terminal === address);
  run("agent.focus", { terminal: address });
  run("pane.focus", { terminal: address });
}

const say = (title) => notify({ title, level: "info", timeout: 2000 });

// The agent on the pane the leader was opened from.
export function agentAt(open) {
  const p = panes().find((x) => x.pane === open?.pane);
  return p?.status != null ? p.terminal : null;
}

// d = 1: next in the queue, -1: previous. From outside the queue: its first (or last).
// A done agent turns idle once looked at, so it leaves the queue and the next press goes on to the next one.
export function nextNeed(d, open) {
  const q = needsMeQueue();
  if (!q.length) return say("Nothing needs you");
  const i = q.findIndex((a) => a.address === agentAt(open));
  const to = i < 0 ? (d > 0 ? q[0] : q.at(-1)) : q[(i + d + q.length) % q.length];
  if (i >= 0 && q.length === 1) return say("Only this one needs you");
  goToAgent(to.address);
}

// The jumplist lives in shared "jumps": { list: [{space, tab, pane}], at, going }. Moving sets `at` and
// `going` first (jumpTo), so the recorder knows this arrival is a move along the list, not a new jump.
export function jumpBy(d) {
  const j = shared("jumps");
  const live = new Set(panes().map((p) => p.pane));
  let at = (j?.at ?? 0) + d;
  while (j && at >= 0 && at < j.list.length && !live.has(j.list[at].pane)) at += d;
  if (!j || at < 0 || at >= j.list.length) return say(d < 0 ? "No older jump" : "No newer jump");
  jumpTo(at);
  focusPane(j.list[at].pane);
}

// Zen: the shown pane alone. Remembers what it hid, shrank (and whether it zoomed) to put back the second time.
// bufferline leaves the tab row and side panel alone while shared "zen" is set.
// The buffer row is shrunk to 0 px, not hidden: its bufferline holds ctrl-space (ADR 0003), and `<mod>.<command>`
// reaches shown copies only. A 0 px row still counts as shown (tried in the app, #15); hidden, zen was a trap.
const ZEN_HIDE = ["sidebar", "tab-row", "panel"];
const ZEN_SHRINK = "tabs-row";
export function zen(open) {
  const z = shared("zen");
  if (z) {
    for (const id of z.hid) run("layout.show", { id });
    if (z.shrunk) run("layout.resize", { id: ZEN_SHRINK, px: z.shrunk });
    const p = panes().find((x) => x.pane === z.zoomed);
    if (p?.zoomed) run("pane.zoom", { pane: p.pane });
    setShared("zen", null);
    return;
  }
  const root = layout();
  // The sidebar counts as shown when the leader showed it only for itself.
  const hid = ZEN_HIDE.filter((id) => { const n = find(root, id); return n && !n.hidden && !(id === "sidebar" && open?.sidebarHidden); });
  const row = find(root, ZEN_SHRINK);
  const shrunk = row && !row.hidden && row.size?.px > 0 ? row.size.px : null;
  const p = panes().find((x) => x.pane === open?.pane);
  const zoom = p && !p.zoomed && panes().filter((x) => x.tab === p.tab).length > 1;
  setShared("zen", { hid, shrunk, zoomed: zoom ? p.pane : null });
  for (const id of hid) run("layout.hide", { id });
  if (shrunk) run("layout.resize", { id: ZEN_SHRINK, px: 0 });
  if (zoom) run("pane.zoom", { pane: p.pane });
}

// Ends the agent on the pane the leader came from, after asking (the shipped confirm dialog).
export function killAgent(open) {
  const address = agentAt(open);
  const a = agents().find((x) => x.address === address);
  if (!a) return say("No agent on this pane");
  openOverlay({ mod: "confirm", kind: "dialog", width: 420, height: 190, props: {
    title: `Kill ${a.program?.name ?? "agent"}?`,
    detail: `${a.space_name} › tab ${a.tab_name}${a.title ? ` (${a.title})` : ""}. Ends the program; its pane closes.`,
    command: { name: "terminal.kill", args: { terminal: address } },
  } });
}
