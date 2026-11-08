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
    "f Find in terminal",
    "i Jump forward",
    "o Jump back",
    "SPC Find agent",
    ": Command palette",
    "å Next agent that needs me",
    "Å Prev agent that needs me",
    "a +agents",
    "b +buffer",
    "g +git",
    "t +tabs",
    "u +ui",
    "w +panes",
  ]);
  ok("top level: every key, <space> as SPC, in which-key's order");

  fire(find(h.leader.render(), "leader"), "on_key_down", { key: "a", key_char: "a" }, h.cx);
  assert.deepEqual(shown(h), [
    "a Toggle agents",
    "d Kill agent (asks first)",
    "f Focus agents list",
    "g Toggle grouping (buffer/status)",
    "i Toggle idle agents",
    "n Next agent",
    "N Prev agent",
    "p Pin/unpin agent",
  ]);
  ok("a group: sorted the same way, lower case before upper");

  noSpawnErrors();
  console.log("leader-menu: all passed");
})().catch((e) => { console.error(e); process.exit(1); });
