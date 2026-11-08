// The leader menu (leader/main.js TREE) as nvim's which-key shows it: every key listed, <space> readable, and the order
// of which-key's default sort (non-groups before groups, letters/digits before other keys, <Space> before other symbols,
// then natural order, lower case first). Issue #1.
const assert = require("node:assert/strict");
const { fakeHerdr, noSpawnErrors, MODS, find, fire, strings } = require("./fake-herdr.cjs");

const ok = (name) => console.log(`  ok  ${name}`);

// Each row is key, "→", label: the keys shown, top to bottom.
const shown = (h) => {
  const s = strings(find(h.leader.render(), "leader"));
  return s.flatMap((x, i) => (x === "→" ? [`${s[i - 1]} ${s[i + 1]}`] : []));
};

(async () => {
  const h = fakeHerdr();
  h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }] });
  h.addPane({ pane: "p1", tab: "b1" });
  h.bar = h.load(MODS.bufferline);
  h.leader = h.load(MODS.leader);
  h.command(MODS.bufferline, "leader");
  await h.settle(); h.flushTimers(); await h.settle();

  assert.deepEqual(shown(h), [
    "1-9 Buffer N",
    "e Explorer (files)",
    "i Jump forward",
    "o Jump back",
    "SPC Find agent",
    "? Key help",
    "a +agents",
    "b +buffer",
    "g +git",
    "t +tabs",
    "u +ui",
    "w +panes",
    "å +next",
    "Å +prev",
  ]);
  ok("top level: every key, <space> as SPC, in which-key's order");

  fire(find(h.leader.render(), "leader"), "on_key_down", { key: "a", key_char: "a" }, h.cx);
  assert.deepEqual(shown(h), [
    "a Toggle agents",
    "d Kill agent (asks first)",
    "g Toggle grouping (buffer/status)",
    "i Toggle idle agents",
    "p Pin/unpin agent",
  ]);
  ok("a group: sorted the same way");

  fire(find(h.leader.render(), "leader"), "on_key_down", { key: "backspace" }, h.cx);
  fire(find(h.leader.render(), "leader"), "on_key_down", { key: "Å", key_char: "Å" }, h.cx);
  assert.deepEqual(shown(h), ["a Agent that needs me", "b Buffer", "t Tab"]);
  ok("Å +prev: like nvim's [ (å +next the same)");

  // The sidebar hidden: ctrl-space shows it just for the leader. <leader>aa must keep it, or the agents list it
  // focuses is hidden again and gets nothing.
  {
    const k = fakeHerdr();
    k.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }] });
    k.addPane({ pane: "p1", tab: "b1" });
    k.bar = k.load(MODS.bufferline);
    k.leader = k.load(MODS.leader);
    const node = (id, n = k.world.layout) => n.id === id ? n : (n.children ?? []).map((c) => node(id, c)).find(Boolean);
    for (const keys of [["a", "a"]]) {
      node("sidebar").hidden = true;
      k.command(MODS.bufferline, "leader");
      await k.settle(); k.flushTimers(); await k.settle();
      assert.equal(node("sidebar").hidden, false);
      k.takeCalls();
      for (const key of keys) fire(find(k.leader.render(), "leader"), "on_key_down", { key, key_char: key }, k.cx);
      const calls = k.takeCalls().map(([name, args]) => `${name} ${JSON.stringify(args ?? {})}`);
      assert.ok(!calls.includes('layout.hide {"id":"sidebar"}'), `<leader>${keys.join("")} hid the sidebar: ${calls}`);
      assert.ok(calls.includes("agents-list.focus {}"), `<leader>${keys.join("")} did not focus the list: ${calls}`);
      ok(`<leader>${keys.join("")} with the sidebar hidden: keeps it, focuses the agents list`);
    }
  }

  noSpawnErrors();
  console.log("leader-menu: all passed");
})().catch((e) => { console.error(e); process.exit(1); });
