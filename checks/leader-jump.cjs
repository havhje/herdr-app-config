// The leader's moves, through its keys (leader/main.js TREE): <leader>o / <leader>i walk the jumplist, <leader>å / <leader>Å
// walk the agents that need me. The bufferline (lite-tabs) keeps both records the leader reads: shared "jumps" and
// shared "agents.log". Pinned before these move, so the move shows up as a change here.
const assert = require("node:assert/strict");
const { fakeHerdr, noSpawnErrors, MODS, find, fire, plain } = require("./fake-herdr.cjs");

const ok = (name) => console.log(`  ok  ${name}`);

// ctrl-space (keys.json lite-tabs:leader), then one key in the leader, as a person would.
async function leaderKey(h, key) {
  h.command(MODS.bufferline, "leader");
  await h.settle();
  h.flushTimers(); // the bufferline hands the leader the keyboard 60ms later (run "leader.focus")
  await h.settle();
  h.takeCalls();
  fire(find(h.leader.render(), "leader"), "on_key_down", { key, key_char: key }, h.cx);
  return h.takeCalls();
}
const at = (h) => h.world.focused.pane;
// The app redraws the bufferline on every focus change; that is when it records.
const land = (h) => h.bar.render();
const jumps = (h) => { const j = h.shared("jumps"); return { at: j.at, list: j.list.map((e) => `${e.tab}/${e.pane}`), going: j.going?.tab ?? null }; };
const lastNote = (h) => h.notes.at(-1)?.title;

function start(build) {
  const h = fakeHerdr();
  build(h);
  h.bar = h.load(MODS.bufferline);
  h.leader = h.load(MODS.leader);
  return h;
}

(async () => {
  // ---- jumplist ----
  const h = start((h) => {
    h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }, { id: "b2" }] });
    h.addSpace({ id: "s2", name: "beta", tabs: [{ id: "b3" }] });
    h.addPane({ pane: "p1", tab: "b1" });
    h.addPane({ pane: "p2", tab: "b2" });
    h.addPane({ pane: "p3", tab: "b3" });
    h.addPane({ pane: "p3b", tab: "b3" });
  });
  for (const p of ["p1", "p2", "p3"]) { h.focusPane(p); land(h); }
  assert.deepEqual(jumps(h), { at: 2, list: ["b1/p1", "b2/p2", "b3/p3"], going: null });
  ok("jumplist: each tab landed on is a jump, newest last");

  h.focusPane("p3b"); land(h);
  assert.deepEqual(jumps(h), { at: 2, list: ["b1/p1", "b2/p2", "b3/p3b"], going: null });
  ok("jumplist: another pane in the same tab updates that jump, adds none");

  {
    const calls = await leaderKey(h, "o");
    // The leader closes, gives the keyboard back where it was opened, then jumps.
    assert.deepEqual(plain(calls), [["layout.hide", { id: "leader" }], ["pane.focus", { pane: "p3b" }], ["pane.focus", { pane: "p2" }]]);
    assert.deepEqual(jumps(h), { at: 1, list: ["b1/p1", "b2/p2", "b3/p3b"], going: "b2" });
    land(h);
    assert.deepEqual(jumps(h), { at: 1, list: ["b1/p1", "b2/p2", "b3/p3b"], going: null });
    ok("<leader>o: focuses the older jump's pane; arriving there is not a new jump");
  }

  await leaderKey(h, "o"); land(h);
  assert.equal(at(h), "p1");
  assert.equal(jumps(h).at, 0);
  await leaderKey(h, "o"); land(h);
  assert.equal(at(h), "p1");
  assert.equal(lastNote(h), "No older jump");
  ok("<leader>o at the oldest jump: stays, says \"No older jump\"");

  await leaderKey(h, "i"); land(h);
  assert.equal(at(h), "p2");
  await leaderKey(h, "i"); land(h);
  assert.equal(at(h), "p3b");
  await leaderKey(h, "i"); land(h);
  assert.equal(at(h), "p3b");
  assert.equal(lastNote(h), "No newer jump");
  ok("<leader>i: walks forward to the newest, then says \"No newer jump\"");

  await leaderKey(h, "o"); land(h); // back on b2
  h.focusPane("p1"); land(h); // a click elsewhere: a new jump
  assert.deepEqual(jumps(h), { at: 1, list: ["b2/p2", "b1/p1"], going: null });
  ok("jumplist: a new jump from the middle drops the jumps ahead and the older visit to the same tab");

  h.focusPane("p3"); land(h);
  h.removePane("p1");
  await leaderKey(h, "o"); land(h);
  assert.equal(at(h), "p2");
  assert.equal(jumps(h).at, 0);
  ok("<leader>o: skips a jump whose pane is gone");

  // ---- needs-me queue ----
  // Blocked first, then done; in each, the one waiting longest first (its tab's changed_at, or when the status log saw it).
  const q = start((h) => {
    h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1", changed_at: 200 }, { id: "b2", changed_at: 100 }] });
    h.addSpace({ id: "s2", name: "beta", tabs: [{ id: "b3", changed_at: 100 }, { id: "b4", changed_at: 50 }, { id: "b5" }] });
    h.addPane({ pane: "p1", tab: "b1", terminal: "t1", status: "blocked" });
    h.addPane({ pane: "p2", tab: "b2", terminal: "t2", status: "done" });
    h.addPane({ pane: "p3", tab: "b3", terminal: "t3", status: "blocked" });
    h.addPane({ pane: "p4", tab: "b4", terminal: "t4", status: "working" });
    h.addPane({ pane: "p5", tab: "b5" });
  });
  q.focusPane("p5"); land(q);

  {
    const calls = await leaderKey(q, "å");
    assert.deepEqual(plain(calls).slice(-2), [["agent.focus", { terminal: "t3" }], ["pane.focus", { terminal: "t3" }]]);
    ok("<leader>å from outside the queue: the longest-blocked agent first (focus agent, then its pane)");
  }
  await leaderKey(q, "å");
  assert.equal(at(q), "p1");
  ok("<leader>å: then the next blocked one");
  await leaderKey(q, "å");
  assert.equal(at(q), "p2");
  assert.equal(q.terminal("t2").status, "idle", "the fake: looking at a done agent makes it idle");
  ok("<leader>å: after the blocked ones, the done one");
  await leaderKey(q, "å");
  assert.equal(at(q), "p3");
  ok("<leader>å: off the queue (the done one turned idle once seen): back to its first");
  await leaderKey(q, "Å");
  assert.equal(at(q), "p1");
  ok("<leader>Å: backward, wrapping round");

  {
    // The status log: the bufferline notes an agent turning blocked, or finishing; the queue then orders by that time.
    land(q);
    q.setStatus("t4", "blocked");
    land(q);
    const log = q.shared("agents.log").map((e) => `${e.address}:${e.what}`);
    assert.deepEqual(log, ["t4:blocked"]);
    q.focusPane("p5"); land(q);
    await leaderKey(q, "Å");
    assert.equal(at(q), "p4", "the just-blocked agent waits least: last in the queue");
    q.setStatus("t1", "working"); land(q);
    q.setStatus("t1", "idle"); land(q);
    assert.deepEqual(q.shared("agents.log").map((e) => `${e.address}:${e.what}`), ["t4:blocked", "t1:done"]);
    ok("status log: blocked and working→idle (done) are logged; a newly blocked agent goes last in the queue");
  }

  {
    const n = start((h) => {
      h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }, { id: "b2" }] });
      h.addPane({ pane: "p1", tab: "b1", terminal: "t1", status: "idle" });
      h.addPane({ pane: "p2", tab: "b2", terminal: "t2", status: "working" });
    });
    n.focusPane("p1"); land(n);
    await leaderKey(n, "å");
    assert.equal(lastNote(n), "Nothing needs you");
    assert.equal(at(n), "p1");
    n.setStatus("t2", "blocked");
    await leaderKey(n, "å");
    assert.equal(at(n), "p2");
    await leaderKey(n, "å");
    assert.equal(lastNote(n), "Only this one needs you");
    assert.equal(at(n), "p2");
    ok("<leader>å: says \"Nothing needs you\" with none, \"Only this one needs you\" when on the only one");
  }

  {
    // The queue reads agent status as everywhere else (lib/agent-status.js, #11): an agent whose sub-agent is stuck
    // is blocked and in it; a done agent put away (settled) isn't news and isn't.
    const m = start((h) => {
      h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }, { id: "b2" }, { id: "b3" }] });
      h.addPane({ pane: "p1", tab: "b1", terminal: "t1", status: "working" });
      h.addSubAgent({ address: "k1", parent: "t1", status: "blocked" });
      h.addPane({ pane: "p2", tab: "b2", terminal: "t2", status: "done" });
      h.addPane({ pane: "p3", tab: "b3" });
    });
    Object.assign(m.terminal("t2"), { turn: 3, labels: { settled: "x:3" } });
    m.focusPane("p3"); land(m);
    await leaderKey(m, "å");
    assert.equal(at(m), "p1");
    await leaderKey(m, "å");
    assert.equal(lastNote(m), "Only this one needs you");
    ok("needs-me queue: an agent with a stuck sub-agent is in it; a settled done one isn't");
  }

  {
    // A turn that failed needs me as a question does: an agent whose own terminal says `error` is in the queue as
    // blocked (ahead of a done one), though agents() has no such word (the fake gives it as idle there, as Herdr does).
    const e = start((h) => {
      h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1", changed_at: 50 }, { id: "b2", changed_at: 100 }, { id: "b3" }] });
      h.addPane({ pane: "p1", tab: "b1", terminal: "t1", status: "done" });
      h.addPane({ pane: "p2", tab: "b2", terminal: "t2", status: "error" });
      h.addPane({ pane: "p3", tab: "b3" });
    });
    e.focusPane("p3"); land(e);
    await leaderKey(e, "å");
    assert.equal(at(e), "p2", "the errored agent first: it reads blocked");
    await leaderKey(e, "å");
    assert.equal(at(e), "p1");
    ok("needs-me queue: an agent whose own terminal is in error is in it, as blocked");
  }

  {
    // <leader>bb: back to the buffer shown before this one (noted as the bufferline redraws).
    const b = start((h) => {
      h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }] });
      h.addSpace({ id: "s2", name: "beta", tabs: [{ id: "b2" }] });
      h.addPane({ pane: "p1", tab: "b1" });
      h.addPane({ pane: "p2", tab: "b2" });
    });
    b.focusPane("p1"); land(b);
    b.focusPane("p2"); land(b);
    await leaderKey(b, "b");
    fire(find(b.leader.render(), "leader"), "on_key_down", { key: "b", key_char: "b" }, b.cx);
    assert.equal(at(b), "p1");
    ok("<leader>bb: back to the buffer shown before");

    // The leader sits in the sidebar: a hidden sidebar shows for it, and hides again when the leader closes.
    b.command(MODS.bufferline, "leader");
    await b.settle();
    b.flushTimers();
    await b.settle();
    b.takeCalls();
    fire(find(b.leader.render(), "leader"), "on_key_down", { key: "escape" }, b.cx);
    assert.deepEqual(plain(b.takeCalls()), [["layout.hide", { id: "leader" }], ["pane.focus", { pane: "p1" }]]);
    b.world.layout.children.find((n) => n.id === "sidebar").hidden = true;
    b.command(MODS.bufferline, "leader");
    await b.settle();
    b.flushTimers();
    await b.settle();
    assert.deepEqual(plain(b.takeCalls()).filter(([n]) => n.startsWith("layout.")), [["layout.show", { id: "sidebar" }], ["layout.show", { id: "leader" }]]);
    fire(find(b.leader.render(), "leader"), "on_key_down", { key: "escape" }, b.cx);
    assert.deepEqual(plain(b.takeCalls()), [["layout.hide", { id: "leader" }], ["layout.hide", { id: "sidebar" }], ["pane.focus", { pane: "p1" }]]);
    ok("ctrl-space with the sidebar hidden: shows it for the leader; esc hides both, keyboard back to the pane");
  }

  noSpawnErrors();
  console.log("leader-jump: all passed");
})().catch((e) => { console.error(e); process.exit(1); });
