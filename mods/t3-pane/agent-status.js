// Generated from lib/agent-status.js by scripts/sync-lib. Edit lib/, not this copy.
// Agent status, one rule for the bufferline, pane headers, the agents list, the agent finder and the needs-me queue.
// An agent reads with its sub-agents: one stuck anywhere under it needs the person; then its own done; an agent
// waiting on working sub-agents is still at work. A done agent put away (settled) or snoozed isn't news: it reads idle.
// How a mark is drawn is here too, in one form per kind of place (see FORMS).
import { div, svg } from "gpui-kit";
import { agents, terminals, spaces, shared } from "herdr";

// How urgent a word is, for sorting: blocked > done > working > idle; no word 0.
const URGENCY = { blocked: 4, done: 3, working: 2, idle: 1 };
export const urgency = (word) => URGENCY[word] ?? 0;
export const mostUrgent = (words) => words.reduce((m, w) => (urgency(w) > urgency(m) ? w : m), null);

// What a mark says (a hover label, a screen reader, a section of the agents list). Form "row", the agent finder's:
// only news is said, in its own words; else null.
const LABEL = { blocked: "Needs you", done: "Done", working: "Working", idle: "Idle" };
const NEWS = { blocked: "needs you", done: "finished" };
export const label = (word, form) => (form === "row" ? NEWS[word] ?? null : LABEL[word] ?? "Unknown");

// Colours mean agent status only, the same everywhere: each word takes the theme's token of that name.
export const colour = (t, word) => t[word] ?? t.dim;
// As text, where a mark is a character (a bufferline cell, a finder row).
const GLYPH = { working: "●", blocked: "!", done: "✓", idle: "○" };
export const glyph = (word) => GLYPH[word] ?? "·";

// Marks by form. Text forms can't spin: a working agent is a dot there.
//   cell: the bufferline's, a coloured character; idle draws nothing.
//   row:  the agent finder's, a coloured character; idle a ring "○".
//   pane: a pane header's: spinner, "!" box, dot; idle draws nothing.
//   list: the agents list's: as pane, idle a ring; no word an empty 12px slot.
//   hint: one small dot of the word's colour (a closed group's), idle draws nothing.
const spinner = (t) => svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
const box = (t) => div().size(12).flex_none().rounded(3).bg(t.blocked + "26").text_size(10).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
// Dot and ring are 6 with 3 each side: every mark is 12 wide.
const dot = (bg) => div().size(6).mx(3).flex_none().rounded_full().bg(bg);
const ring = (t) => div().size(6).mx(3).flex_none().rounded_full().border(1.5).border_color(t.idle ?? t.dim);
const text = (t, word) => div().flex_none().text_color(colour(t, word)).child(glyph(word));
export function mark(t, word, form) {
  if (form === "cell") return word && word !== "idle" ? text(t, word) : null;
  if (form === "row") return text(t, word);
  if (form === "hint") return word && word !== "idle" ? div().size(6).flex_none().rounded_full().bg(colour(t, word)) : null;
  if (word === "working") return spinner(t);
  if (word === "blocked") return box(t);
  if (word === "done") return dot(t.done);
  if (form === "pane") return null;
  return word === "idle" ? ring(t) : dot(t.dim + "00");
}

// ---- reading it ----

// Live sub-agents of `addr`, all the way down.
function descendants(all, addr) {
  return all.filter((k) => k.parent === addr && k.state === "live").flatMap((k) => [k, ...descendants(all, k.address)]);
}

// A sub-agent's own word: one without a pane isn't in agents(), so its raw word, error counting as blocked.
// It's never done: it reports to its parent, and the parent's done is the news.
function subWord(k, listed) {
  const s = k.status === "error" ? "error" : listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
}

// Its own word with what's under it: needing the person first, then its own done, then busy or waiting on
// sub-agents it will hear back from, else its own.
function withSubAgents(own, kids) {
  if (own === "blocked" || kids.includes("blocked")) return "blocked";
  return own !== "done" && kids.includes("working") ? "working" : own;
}

// A settled agent stays settled until new work: busy now, or a turn ended since. Label removal can still be in
// flight, or the Inbox not started, so the label alone isn't enough. `k` is its terminal.
function stillSettled(k, word, kids) {
  const tag = k?.labels?.settled;
  if (!tag) return false;
  const busy = (s) => s === "working" || s === "blocked";
  return !busy(word) && !kids.some(busy) && (k.turn ?? 0) <= Number(tag.split(":")[1]);
}
const notNews = (k, word, kids) => stillSettled(k, word, kids) || Number(k?.labels?.snoozed) > Date.now();

// Snapshot once per render. Every agent's status, sub-agents in:
//   agent(address, word?)  its word (`word` stands in for the one agents() gives, as the list's held done), null if none
//   fromSubAgent(address)  its word is its sub-agents', not its own
//   subAgent(terminal)     a sub-agent's own word (a terminal from terminals())
//   tab(id), space(id)     the most urgent of their agents; with none of them in agents(), Herdr's own rollup
//                          (agents() isn't documented to list other machines' agents: a remote buffer keeps its mark)
export function statusReader() {
  const listed = agents(), all = terminals();
  const words = new Map(listed.map((a) => [a.address, a.status]));
  const term = new Map(all.map((k) => [k.address, k]));
  const kidsMemo = new Map();
  const kidsOf = (addr) => {
    if (!kidsMemo.has(addr)) kidsMemo.set(addr, descendants(all, addr).map((k) => subWord(k, words)));
    return kidsMemo.get(addr);
  };
  // A turn that failed needs the person as a question does. Programs report it as `error`; agents() has no such
  // word, so it's read from the terminal's own.
  const own = (addr, word) => (term.get(addr)?.status === "error" ? "blocked" : word);
  const agent = (addr, word = words.get(addr)) => {
    if (word == null) return null;
    const mine = own(addr, word), kids = kidsOf(addr), tree = withSubAgents(mine, kids);
    return tree !== "blocked" && notNews(term.get(addr), mine, kids) ? "idle" : tree;
  };
  const among = (pick, rollup) => {
    const here = listed.filter(pick);
    return here.length ? mostUrgent(here.map((a) => agent(a.address))) : rollup() ?? null;
  };
  let spaceList;
  const spaceInfo = () => (spaceList = spaceList ?? spaces());
  return {
    agent,
    fromSubAgent: (addr) => { const w = agent(addr); return w != null && w !== "idle" && w !== own(addr, words.get(addr)); },
    subAgent: (k) => subWord(k, words),
    tab: (id) => among((a) => a.tab === id, () => spaceInfo().flatMap((s) => s.tabs ?? []).find((c) => c.id === id)?.status),
    space: (id) => among((a) => a.space === id, () => spaceInfo().find((s) => s.id === id)?.status),
  };
}

// The needs-me queue: agents blocked or done, blocked first; in each, the one waiting longest first (when the
// status log saw it, else when its tab last changed).
export function needsMeQueue() {
  const read = statusReader();
  const since = new Map();
  for (const e of shared("agents.log") ?? []) since.set(e.address, e.at);
  const tabAt = new Map(spaces().flatMap((s) => s.tabs ?? []).map((c) => [c.id, c.changed_at ?? 0]));
  const at = (a) => since.get(a.address) ?? tabAt.get(a.tab) ?? 0;
  return agents().map((a) => ({ a, w: read.agent(a.address) }))
    .filter(({ w }) => w === "blocked" || w === "done")
    .sort((x, y) => urgency(y.w) - urgency(x.w) || at(x.a) - at(y.a))
    .map(({ a }) => a);
}
