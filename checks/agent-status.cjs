// Agent status as the three places show it today: the bufferline (lite-tabs), the pane header (t3-pane) and
// the agents list (t3-agents). Pinned before the status display moves into one place, so the move shows
// up as a change here. They disagree today, on purpose or not; TODAY records each as it is:
//   - working: the bufferline draws a dot glyph "●"; the header and list draw a spinning spinner.
//   - done: the bufferline draws a tick "✓"; the header and list draw a dot.
//   - idle: the bufferline and header draw nothing; the list draws a ring.
//   - the bufferline shows its buffer's status (Herdr's rollup of the buffer's agents); the header and list work
//     out their own from the agent and its sub-agents (a stuck sub-agent, or one in error, makes them "!").
//   - a done agent put away (settled) or snoozed: the header draws nothing, the list a ring (idle).
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
{
  const h = withSub("working", "blocked");
  const s = shown(h);
  assert.deepEqual([s.header, s.list], ["! #blocked", "! #blocked"]);
  assert.equal(listLabel(h, "t1"), "Needs you (sub-agent)");
  ok("sub-agent blocked under a working agent: header !, list ! \"Needs you (sub-agent)\"");
}
{
  const h = withSub("idle", "error");
  const s = shown(h);
  assert.deepEqual([s.header, s.list], ["! #blocked", "! #blocked"]);
  ok("sub-agent in error under an idle agent: header and list both !");
}
{
  const h = withSub("idle", "working");
  const s = shown(h);
  assert.deepEqual([s.header, s.list], ["spinner #working", "spinner #working"]);
  assert.equal(listLabel(h, "t1"), "Working (sub-agent)");
  ok("sub-agent working under an idle agent: header and list spin, list says (sub-agent)");
}
{
  // Done, then put away (Herdr's "settled" label at its last turn): no longer news.
  const h = world("done");
  Object.assign(h.terminal("t1"), { turn: 3, labels: { settled: "x:3" } });
  const s = shown(h);
  assert.deepEqual([s.bufferline, s.header, s.list], ["✓ #done", "none", "ring #idle"]);
  assert.equal(listLabel(h, "t1"), "Idle");
  ok("done but settled: bufferline ✓ (Herdr's rollup), header none, list ring \"Idle\"");
}

noSpawnErrors();
console.log("agent-status: all passed");
