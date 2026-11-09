// The links pane (mods/links): reads the focused agent's screen, keeps URLs and non-code files that exist, newest
// first, remembers them past the screen, follows the last focused agent; enter opens, cc copies. And <leader>ul.
const assert = require("node:assert/strict");
const { fakeHerdr, noSpawnErrors, MODS, find, fire, strings, plain } = require("./fake-herdr.cjs");

const ok = (name) => console.log(`  ok  ${name}`);

(async () => {

  const h = fakeHerdr();
  h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }] });
  h.addPane({ pane: "p1", tab: "b1", terminal: "t1", status: "working", cwd: "/work/alpha" });
  h.addPane({ pane: "p2", tab: "b1", terminal: "t2", status: "idle", cwd: "/work/beta" });
  h.addPane({ pane: "px", tab: "b1", mod: "explorer" });
  h.focusPane("p1");
  const screens = {
    t1: "Edited CLAUDE.md. Wrote /tmp/x/report.html and docs/notes.md.\nSee https://example.com/a?b=1, and main.js\n\x1b[1mchart.png\x1b[0m gone.pdf\n",
    t2: "Here: ~/pics/cat.jpg\n",
  };
  const files = new Set(["/work/alpha/CLAUDE.md", "/tmp/x/report.html", "/work/alpha/docs/notes.md", "/work/alpha/chart.png", "/home/me/pics/cat.jpg"]);
  h.world.exec = (cmd, args) => {
    if (cmd === "hc") return { code: 0, stdout: screens[args[1]] ?? "", stderr: "" };
    if (cmd === "sh" && args[2] === "tracked") return { code: 0, stdout: args.slice(3).filter((p) => p === "/work/alpha/CLAUDE.md").map((p) => p + "\0").join(""), stderr: "" };
    if (cmd === "sh") return { code: 0, stdout: args.slice(3).filter((p) => files.has(p)).map((p) => p + "\0").join(""), stderr: "" };
    if (cmd === "xdg-open" || cmd === "omarchy-launch-editor" || cmd === "wl-copy") return { code: 0, stdout: "", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
  const node = (id) => { const f = (n) => n?.id === id ? n : (n?.children ?? []).map(f).find(Boolean); return f(h.world.layout); };
  const links = h.load(MODS.links);
  const settle = async () => { for (let i = 0; i < 4; i++) await h.settle(); };
  const poll = async () => { links.view.poll(h.cx); await settle(); };
  const shown = () => plain(links.view.shown().map((e) => e.link));
  await settle();
  assert.deepEqual(h.world.execs, []);
  ok("hidden: reads nothing (Herdr keeps a hidden copy's timers running)");
  node("links").hidden = false; node("panel").hidden = false;
  await poll();

  assert.deepEqual(shown(), ["/work/alpha/chart.png", "https://example.com/a?b=1", "/work/alpha/docs/notes.md", "/tmp/x/report.html"]);
  ok("focused agent: URLs and existing non-code files, newest (lowest on screen) first; code, git-tracked and missing files left out");
  assert.ok(strings(links.render()).includes("chart.png"));
  ok("rows show the file's name");

  screens.t1 = "all new screen\n";
  await poll();
  assert.equal(shown().length, 4);
  ok("links stay after they scroll off the screen");

  files.delete("/tmp/x/report.html");
  await poll();
  assert.ok(!shown().includes("/tmp/x/report.html"));
  ok("a file that's gone drops out");

  h.focusPane("p2");
  await poll();
  assert.deepEqual(shown(), ["/home/me/pics/cat.jpg"]);
  h.focusPane("px");
  await poll();
  assert.deepEqual(shown(), ["/home/me/pics/cat.jpg"]);
  ok("follows the focused agent; with a mod focused, keeps the last agent");

  const press = async (...keys) => { for (const key of keys) fire(find(links.render(), "links"), "on_key_down", { keystroke: key, key, key_char: key }, h.cx); await settle(); };
  h.focusPane("p1"); await poll();
  h.world.execs.length = 0;
  await press("enter");
  await press("j", "enter");
  await press("j", "enter");
  await press("c", "c");
  const ran = h.world.execs.filter(([c]) => c !== "hc" && c !== "sh").map(([c, a]) => [c, a]);
  assert.deepEqual(plain(ran), [
    ["xdg-open", ["/work/alpha/chart.png"]],
    ["xdg-open", ["https://example.com/a?b=1"]],
    ["omarchy-launch-editor", ["/work/alpha/docs/notes.md"]],
    ["wl-copy", ["--", "/work/alpha/docs/notes.md"]],
  ]);
  assert.deepEqual(h.notes.at(-1), { title: "Copied", body: "/work/alpha/docs/notes.md", timeout: 2000 });
  ok("enter opens (images and URLs with xdg-open, notes in nvim); cc copies the path with a toast");

  // Reads on events, not on a clock: the agent finishing (working to anything else), or the pane being opened.
  {
    h.focusPane("p1"); await poll();
    const reads = () => h.world.execs.filter(([c]) => c === "hc").length;
    const tick = async () => { links.view.tick(h.cx); await settle(); };
    h.setStatus("t1", "working"); await tick();
    const n = reads();
    await tick(); await tick();
    assert.equal(reads(), n);
    ok("while the agent works, no screen reads");
    screens.t1 = "done: https://example.com/new\n";
    h.setStatus("t1", "idle"); await tick();
    assert.equal(reads(), n + 1);
    assert.equal(shown()[0], "https://example.com/new");
    await tick();
    assert.equal(reads(), n + 1);
    ok("the agent finishing reads its screen once");
    node("links").hidden = true; await tick();
    node("links").hidden = false; await tick();
    assert.equal(reads(), n + 2);
    ok("opening the pane reads once");
    assert.deepEqual(plain(h.world.execs.filter(([c]) => c === "hc").map(([, a]) => a).filter((a) => a.length !== 2 || a[0] !== "read")), []);
    ok("reads the visible screen only: a history read (--lines) scrolls a full-screen agent for seconds");
  }

  // p pins the row: pinned links sit on top for every agent, outlive their file and a restart; p again unpins.
  {
    h.focusPane("p1"); await poll();
    assert.equal(shown()[1], "/work/alpha/chart.png");
    await press("g", "g", "j", "p");
    assert.equal(shown()[0], "/work/alpha/chart.png");
    assert.equal(shown().filter((l) => l === "/work/alpha/chart.png").length, 1);
    ok("p pins the row: it moves to the top, listed once");
    h.focusPane("p2"); await poll();
    assert.deepEqual(shown(), ["/work/alpha/chart.png", "/home/me/pics/cat.jpg"]);
    files.delete("/work/alpha/chart.png"); h.focusPane("p1"); await poll();
    assert.equal(shown()[0], "/work/alpha/chart.png");
    ok("a pinned link shows for every agent and stays when its file is gone");
    const again = h.load(MODS.links, {}, links.storage);
    assert.deepEqual(plain(again.view.shown().map((e) => e.link)), ["/work/alpha/chart.png"]);
    ok("pins outlive a restart");
    await press("g", "g", "p");
    assert.ok(!shown().includes("/work/alpha/chart.png"));
    ok("p on a pinned row unpins it");
  }

  // <leader>ul: shows the pane (and the side panel); again hides only the pane.
  {
    node("links").hidden = true; node("panel").hidden = true;
    const bar = h.load(MODS.bufferline), leader = h.load(MODS.leader);
    const leaderKey = async (...keys) => {
      h.command(MODS.bufferline, "leader"); await h.settle(); h.flushTimers(); await h.settle();
      for (const key of keys) fire(find(leader.render(), "leader"), "on_key_down", { key, key_char: key }, h.cx);
      await settle();
    };
    assert.equal(node("links").hidden, true);
    await leaderKey("u", "l");
    assert.equal(node("links").hidden, false); assert.equal(node("panel").hidden, false);
    await leaderKey("u", "l");
    assert.equal(node("links").hidden, true); assert.equal(node("panel").hidden, false);
    ok("<leader>ul: shows the links pane with the side panel; again hides the pane only");
  }

  noSpawnErrors();
})().catch((e) => { console.error(e); process.exit(1); });
