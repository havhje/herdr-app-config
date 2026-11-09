// The agent finder's rows (mods/agent-finder, <leader><space>): each agent on one line as the agents list has it
// (#18): its program's icon, what it is on, its buffer, its live sub-agents, and how long it has been in its
// state. That time is the agents list's own (shared "agents.changed", lib/agent-row.js), so an idle agent has one
// too, and both places say the same. The status log (tab) keeps its clock times.
const assert = require("node:assert/strict");
const { fakeHerdr, noSpawnErrors, MODS, find, strings, fire, walk, marks } = require("./fake-herdr.cjs");

const MIN = 60000, HOUR = 60 * MIN;
const ok = (name) => console.log(`  ok  ${name}`);

// alpha: t1 idle for 3h. beta: t2 blocked for 12m with two sub-agents, and the shell the person is on.
function world() {
  const h = fakeHerdr(), now = Date.now();
  h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1", changed_at: now - 3 * HOUR - MIN }] });
  h.addSpace({ id: "s2", name: "beta", tabs: [{ id: "b2", changed_at: now - 12 * MIN - 1000 }, { id: "b3" }] });
  h.addPane({ pane: "p1", tab: "b1", terminal: "t1", status: "idle", title: "fix the bug" });
  h.addPane({ pane: "p2", tab: "b2", terminal: "t2", status: "blocked", title: "review PR 12" });
  h.addSubAgent({ address: "t2a", parent: "t2", status: "working" });
  h.addSubAgent({ address: "t2b", parent: "t2a", status: "working" });
  h.addPane({ pane: "p3", tab: "b3", terminal: "t3" });
  h.focusPane("p3");
  return h;
}
const finder = (h, mode = "agents") => h.load(MODS.agentFinder, { mode, overlay: "o1" });
const rowText = (tree, address) => strings(find(tree, `ap-${address}`));
const rowIds = (tree) => walk(tree).map((n) => n.id).filter((id) => typeof id === "string" && id.startsWith("ap-t"));

{
  const h = world();
  const list = h.load(MODS.agentsList).render();
  const tree = finder(h).render();
  // Needs-you first.
  assert.deepEqual(rowIds(tree), ["ap-t2", "ap-t1"]);
  assert.deepEqual(rowText(tree, "t1"), ["○", "fix the bug", "alpha", "3h"]);
  assert.deepEqual(rowText(tree, "t2"), ["!", "review PR 12", "beta", "⑂2", "needs you", "12m"]);
  ok("rows: mark, what it is on, buffer, sub-agents, news, time in state (idle too)");
  // The same time as the agents list's row.
  for (const a of ["t1", "t2"]) assert.equal(rowText(tree, a).at(-1), strings(find(list, `when-${a}`)).join(""), `${a}: the list's time`);
  ok("rows: the time is the agents list's");
  const pic = walk(find(tree, "ap-t1")).find((n) => n.kind === "svg");
  assert.equal(pic?.source, "icons/claude.svg");
  assert.equal(marks(find(tree, "ap-t2")), "! #blocked");
  ok("rows: the program's icon, the status mark");
}

{
  // Idle agents hidden from the agents list (<leader>ai) keep their time: the finder lists every agent.
  const h = world();
  h.setShared("agents.hideIdle", true);
  const list = h.load(MODS.agentsList).render();
  assert.equal(find(list, "ag-t1"), null);
  assert.equal(rowText(finder(h).render(), "t1").at(-1), "3h");
  ok("an idle agent hidden from the list still has its time");
}

{
  // After a restart the list shares the times it kept, before any agent changes.
  const h = world();
  const first = h.load(MODS.agentsList);
  first.render();
  const h2 = world();
  h2.world.spaces[0].tabs[0].changed_at = Date.now();
  h2.load(MODS.agentsList, {}, first.storage);
  assert.equal(rowText(finder(h2).render(), "t1").at(-1), "3h");
  ok("the list's kept times are shared from its start");
}

{
  // No agents list yet (nothing shared): no time, but a logged "needs you" still dates its row.
  const h = world();
  assert.deepEqual(rowText(finder(h).render(), "t1"), ["○", "fix the bug", "alpha"]);
  h.setShared("agents.log", [{ at: Date.now() - 5 * MIN - 1000, address: "t2", what: "blocked", who: "Claude Code", space: "beta", tab: "1", title: "review PR 12" }]);
  assert.equal(rowText(finder(h).render(), "t2").at(-1), "5m");
  ok("without the list's times: none for idle, the status log's for needs you");
}

{
  // The status log keeps clock times and its own columns.
  const h = world(), at = new Date(2026, 10, 9, 14, 32).getTime();
  h.setShared("agents.log", [{ at, address: "t2", what: "blocked", who: "Claude Code", space: "beta", tab: "1", title: "review PR 12" }]);
  const texts = strings(find(finder(h, "log").render(), `ap-t2-${at}`));
  assert.deepEqual(texts.slice(1), ["!", "Claude Code", "beta › 1", "review PR 12", "needs you"]);
  assert.match(texts[0], /14:32$/);
  ok("status log: clock time, who, where, title, what");
}

{
  // Order: by status, then by time. Needs you: the longest-waiting first. Idle: the newest first.
  const h = fakeHerdr(), now = Date.now();
  const ago = { t1: 2 * HOUR, t2: 5 * MIN, t3: 30 * MIN, t4: 10 * MIN, t5: 1 * HOUR };
  h.addSpace({ id: "s1", name: "alpha", tabs: [...Object.entries(ago).map(([a, ms]) => ({ id: `b-${a}`, changed_at: now - ms })), { id: "b0" }] });
  for (const [a, status] of [["t1", "idle"], ["t2", "blocked"], ["t3", "idle"], ["t4", "idle"], ["t5", "blocked"]]) h.addPane({ pane: `p-${a}`, tab: `b-${a}`, terminal: a, status });
  h.addPane({ pane: "p0", tab: "b0", terminal: "t0" });
  h.focusPane("p0");
  h.load(MODS.agentsList).render();
  assert.deepEqual(rowIds(finder(h).render()), ["ap-t5", "ap-t2", "ap-t4", "ap-t3", "ap-t1"]);
  ok("order: needs you longest-waiting first, idle newest first");
  // Each status under its header, with how many; the headers aren't rows (j/k step over them: see keys).
  const tree = finder(h).render();
  const heads = walk(tree).filter((n) => String(n.id).startsWith("ap-h-")).map((n) => strings(n).join(" "));
  assert.deepEqual(heads, ["Needs you 2", "Idle 3"]);
  const ids = walk(find(tree, "ap-list")).map((n) => n.id).filter((id) => String(id).startsWith("ap-"));
  assert.deepEqual(ids.slice(1, 4), ["ap-h-blocked", "ap-t5", "ap-t2"]);
  assert.equal(strings(find(finder(h, "log").render(), "ap-list")).includes("Idle"), false);
  ok("headers: one per status with its count, none in the status log");
}

{
  // Keys: the list has the keyboard (j/k move, Enter goes); - starts the filter, where letters are the input's
  // and Esc gives the list the keys back.
  const h = world(), f = finder(h);
  const root = () => find(f.render(), "agent-finder");
  const press = (keystroke) => fire(root(), "on_key_down", { keystroke, key: keystroke, key_char: keystroke.length === 1 ? keystroke : null }, h.cx);
  const selected = () => walk(root()).filter((n) => String(n.id).startsWith("ap-t") && n.style.bg === "#selected").map((n) => n.id).join();
  assert.equal(selected(), "ap-t2");
  press("j");
  assert.equal(selected(), "ap-t1");
  press("k");
  assert.equal(selected(), "ap-t2");
  ok("keys: j and k move");
  press("-");
  assert.equal(f.view.filtering, true);
  press("j");
  assert.equal(selected(), "ap-t2", "j is typed, not a move, while filtering");
  press("ctrl-j");
  assert.equal(selected(), "ap-t1");
  press("escape");
  assert.equal(f.view.filtering, false);
  assert.equal(selected(), "ap-t2");
  ok("keys: - starts the filter (letters type, ctrl-j moves), Esc gives the list the keys back");
  press("j");
  h.takeCalls();
  press("enter");
  assert.deepEqual(h.takeCalls().filter(([name]) => name === "agent.focus"), [["agent.focus", { terminal: "t1" }]]);
  ok("keys: Enter goes to the selected agent");
}

noSpawnErrors();
