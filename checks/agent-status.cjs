// Agent status as the three places show it: the bufferline, the pane header and the agents
// list (mods/bufferline, pane-header, agents-list). All three read it one way (lib/agent-status.js): an agent with its sub-agents (a stuck
// sub-agent, or one in error, makes it "!"; a working one under an idle agent makes it working), and a done or idle
// agent put away (settled) or snoozed reads idle; a terminal in error reads blocked. A buffer or tab shows its most
// urgent agent's (blocked > done > working > idle), or Herdr's own when agents() lists none of its agents.
// They draw it in their own form, on purpose (TODAY):
//   - working: the bufferline is text, so a dot glyph "●"; the header and list spin a spinner.
//   - done: the bufferline draws a tick "✓"; the header and list a dot.
//   - blocked: "!" everywhere; the header's and list's is the same 12px box.
//   - idle: the bufferline and header draw nothing; the list draws a ring.
const assert = require("node:assert/strict");
const { fakeHerdr, noSpawnErrors, MODS, find, strings, walk, marks } = require("./fake-herdr.cjs");

const TODAY = {
  working: { bufferline: "● #working", header: "spinner #working", list: "spinner #working", label: "Working" },
  blocked: { bufferline: "! #blocked", header: "! #blocked", list: "! #blocked", label: "Needs you" },
  done: { bufferline: "✓ #done", header: "dot #done", list: "dot #done", label: "Done" },
  idle: { bufferline: "none", header: "none", list: "ring #idle", label: "Idle" },
};

// A buffer's cell in the bufferline: the node right above its name.
const cell = (tree, name) => walk(tree).find((n) => n.items.some((c) => typeof c === "object" && c.items.length === 1 && c.items[0] === name));

// One agent (t1, pane p1) in buffer "alpha", and a plain shell in "beta" where the person is: looking at a done agent would make it idle.
function world(status) {
  const h = fakeHerdr();
  h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }] });
  h.addSpace({ id: "s2", name: "beta", tabs: [{ id: "b2" }] });
  h.addPane({ pane: "p1", tab: "b1", terminal: "t1", status, title: "fix the bug" });
  h.addPane({ pane: "p2", tab: "b2", terminal: "t2" });
  h.focusPane("p2");
  return h;
}
const shown = (h) => ({
  bufferline: marks(cell(h.load(MODS.bufferline).render(), "alpha")),
  header: marks(h.load(MODS.paneHeader, { pane: "p1", terminal: "t1" }).render()),
  list: marks(find(h.load(MODS.agentsList).render(), "status-t1")),
});
const listLabel = (h, address) => find(h.load(MODS.agentsList).render(), `status-${address}`).style.accessibility_label;

const ok = (name) => console.log(`  ok  ${name}`);

for (const [status, want] of Object.entries(TODAY)) {
  const h = world(status);
  assert.deepEqual(shown(h), { bufferline: want.bufferline, header: want.header, list: want.list }, `${status}: marks`);
  assert.equal(listLabel(h, "t1"), want.label, `${status}: list label`);
  ok(`${status}: bufferline ${want.bufferline}, header ${want.header}, list ${want.list} "${want.label}"`);
}

{
  // The header's "!" reads "Needs you" to a screen reader, as the list's.
  const tree = world("blocked").load(MODS.paneHeader, { pane: "p1", terminal: "t1" }).render();
  assert.ok(walk(tree).some((n) => n.style.accessibility_label === "Needs you" && strings(n).join("") === "!"), "header ! is labelled");
  ok("header: blocked mark is labelled Needs you");
  // The header's "!" box is the list's, 12px (it was 14 until #11).
  const box = (node) => walk(node).find((n) => n.items.length === 1 && n.items[0] === "!").style.size;
  assert.deepEqual([box(tree), box(find(world("blocked").load(MODS.agentsList).render(), "status-t1"))], [12, 12]);
  ok("header and list: the same 12px ! box");
}

{
  // A working row recedes in the list while nothing points at it; one that needs you doesn't.
  const row = (status) => find(world(status).load(MODS.agentsList).render(), "ag-t1").style.opacity;
  assert.deepEqual([row("working"), row("blocked"), row("done"), row("idle")], [0.7, 1, 1, 1]);
  ok("list: a working row is faded to 0.7, the rest stay 1");
}

{
  // The bufferline's right end counts agents by status over every buffer; idle isn't counted.
  const h = fakeHerdr();
  h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }] });
  ["working", "working", "blocked", "done", "idle"].forEach((s, i) => h.addPane({ pane: `p${i}`, tab: "b1", terminal: `t${i}`, status: s }));
  h.addSpace({ id: "s2", name: "beta", tabs: [{ id: "b2" }] });
  h.addPane({ pane: "q", tab: "b2" });
  h.focusPane("q");
  const counts = strings(h.load(MODS.bufferline).render()).filter((s) => /^[●!✓] \d+$/.test(s));
  assert.deepEqual(counts, ["● 2", "! 1", "✓ 1"]);
  ok("bufferline: counts ● 2  ! 1  ✓ 1 (working, blocked, done; idle not counted)");
  // A buffer shows its most urgent agent: blocked beats done beats working.
  assert.equal(marks(cell(h.load(MODS.bufferline).render(), "alpha")), "! #blocked");
  ok("bufferline: a buffer shows its most urgent agent's mark");
}

{
  // Done beats working: a buffer with one of each shows ✓, and the list's priority sections run Done, Working, Idle.
  const h = fakeHerdr();
  h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }] });
  ["idle", "working", "done"].forEach((s, i) => h.addPane({ pane: `p${i}`, tab: "b1", terminal: `t${i}`, status: s }));
  h.addSpace({ id: "s2", name: "beta", tabs: [{ id: "b2" }] });
  h.addPane({ pane: "q", tab: "b2" });
  h.focusPane("q");
  assert.equal(marks(cell(h.load(MODS.bufferline).render(), "alpha")), "✓ #done");
  const sections = walk(h.load(MODS.agentsList).render()).map((n) => n.id).filter((id) => /^sec-\d$/.test(id ?? ""));
  assert.deepEqual(sections, ["sec-3", "sec-2", "sec-1"]);
  ok("done beats working: bufferline ✓ for done + working, list sections Done, Working, Idle");
}

{
  // A buffer whose agents agents() doesn't list (another machine's, say) keeps Herdr's own mark for it and its tabs.
  const h = fakeHerdr();
  h.addSpace({ id: "vps/s1", name: "far", tabs: [{ id: "vps/b1", name: "one" }, { id: "vps/b2", name: "two" }] });
  h.addPane({ pane: "vps/p1", tab: "vps/b1", terminal: "vps/t1", status: "blocked" });
  h.addSpace({ id: "s2", name: "beta", tabs: [{ id: "b2" }] });
  h.addPane({ pane: "q", tab: "b2" });
  h.focusPane("q");
  const listed = h.herdr.agents;
  h.herdr.agents = () => listed().filter((a) => !a.space.startsWith("vps/"));
  assert.equal(marks(cell(h.load(MODS.bufferline).render(), "far")), "! #blocked");
  h.focusPane("vps/p1");
  const tabs = h.load(MODS.bufferline, { role: "tabs" }).render();
  assert.deepEqual([marks(cell(tabs, "one")), marks(cell(tabs, "two"))], ["! #blocked", "none"]);
  ok("bufferline: a buffer and tab with no agent in agents() fall back to Herdr's own status");
}

{
  // The shown buffer with two tabs: its status moves onto its tabs (the tab row), so it isn't shown twice.
  const h = fakeHerdr();
  h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1", name: "one" }, { id: "b2", name: "two" }] });
  h.addPane({ pane: "p1", tab: "b1" });
  h.addPane({ pane: "p2", tab: "b2", terminal: "t2", status: "blocked" });
  h.focusPane("p1");
  assert.equal(marks(cell(h.load(MODS.bufferline).render(), "alpha")), "none", "the shown buffer's cell leaves its mark to the tab row");
  const tabs = h.load(MODS.bufferline, { role: "tabs" }).render();
  assert.deepEqual([marks(cell(tabs, "one")), marks(cell(tabs, "two"))], ["none", "! #blocked"]);
  ok("bufferline: with its tab row up, the shown buffer's mark is on the tab instead");
}

// A sub-agent (no pane of its own) under t1: the header and list read t1 with what's under it.
function withSub(own, sub) {
  const h = world(own);
  h.addSubAgent({ address: "k1", parent: "t1", status: sub });
  return h;
}
// The bufferline reads its buffer's agents the same way (until #11 it showed Herdr's rollup of their own words).
{
  const h = withSub("working", "blocked");
  const s = shown(h);
  assert.deepEqual([s.bufferline, s.header, s.list], ["! #blocked", "! #blocked", "! #blocked"]);
  assert.equal(listLabel(h, "t1"), "Needs you (sub-agent)");
  ok("sub-agent blocked under a working agent: bufferline !, header !, list ! \"Needs you (sub-agent)\"");
}
{
  const h = withSub("idle", "error");
  const s = shown(h);
  assert.deepEqual([s.bufferline, s.header, s.list], ["! #blocked", "! #blocked", "! #blocked"]);
  ok("sub-agent in error under an idle agent: bufferline, header and list all !");
}
{
  const h = withSub("idle", "working");
  const s = shown(h);
  assert.deepEqual([s.bufferline, s.header, s.list], ["● #working", "spinner #working", "spinner #working"]);
  assert.equal(listLabel(h, "t1"), "Working (sub-agent)");
  const counts = strings(h.load(MODS.bufferline).render()).filter((x) => /^[●!✓] \d+$/.test(x));
  assert.deepEqual(counts, ["● 1"]);
  ok("sub-agent working under an idle agent: bufferline ● (counted), header and list spin, list says (sub-agent)");
}
{
  // Done, then put away (Herdr's "settled" label at its last turn): no longer news, anywhere.
  const h = world("done");
  Object.assign(h.terminal("t1"), { turn: 3, labels: { settled: "x:3" } });
  const s = shown(h);
  assert.deepEqual([s.bufferline, s.header, s.list], ["none", "none", "ring #idle"]);
  assert.equal(listLabel(h, "t1"), "Idle");
  assert.deepEqual(strings(h.load(MODS.bufferline).render()).filter((x) => /^[●!✓] \d+$/.test(x)), []);
  // Sorted by priority it sits under Idle, as its mark says (until #11: under Done).
  const list = h.load(MODS.agentsList).render();
  assert.deepEqual([Boolean(find(list, "sec-1")), Boolean(find(list, "sec-3"))], [true, false]);
  ok("done but settled: bufferline none (not counted), header none, list ring \"Idle\" in the Idle section");
}
{
  // A turn that failed (its terminal says error; agents() has no such word) needs you: "!" everywhere (until #11 the bufferline drew nothing).
  const s = shown(world("error"));
  assert.deepEqual([s.bufferline, s.header, s.list], ["! #blocked", "! #blocked", "! #blocked"]);
  ok("agent in error: bufferline, header and list all !");
}
{
  // Snoozed (until it wakes): not news either, even while working.
  const h = world("working");
  Object.assign(h.terminal("t1"), { labels: { snoozed: String(Date.now() + 3600000) } });
  const s = shown(h);
  assert.deepEqual([s.bufferline, s.header, s.list], ["none", "none", "ring #idle"]);
  ok("working but snoozed: bufferline none, header none, list ring (until #11 the bufferline ●, the header spun)");
}
{
  // <leader>ai hides idle agents by their status: an idle agent whose sub-agent needs you stays.
  const h = withSub("idle", "blocked");
  h.setShared("agents.hideIdle", true);
  assert.ok(find(h.load(MODS.agentsList).render(), "ag-t1"), "kept");
  const g = world("idle");
  g.setShared("agents.hideIdle", true);
  assert.equal(find(g.load(MODS.agentsList).render(), "ag-t1"), null, "hidden");
  ok("list, idle hidden: an idle agent with a blocked sub-agent stays; a plain idle one goes");
}

noSpawnErrors();
console.log("agent-status: all passed");
