// The explorer's cc (mods/explorer/main.js key): the cursor row's full path to the clipboard through wl-copy,
// with a toast; a lone c copies nothing.
const assert = require("node:assert/strict");
const { fakeHerdr, noSpawnErrors, MODS, find, fire } = require("./fake-herdr.cjs");

const ok = (name) => console.log(`  ok  ${name}`);

(async () => {
  const h = fakeHerdr();
  h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }] });
  h.addPane({ pane: "p1", tab: "b1", cwd: "/work/alpha" });
  h.focusPane("p1");
  // The folder listing (explorer's sh script): a folder "src" and a file "a.txt"; wl-copy works.
  h.world.exec = (cmd, args) => {
    if (cmd === "sh" && args[2] === "files") return { code: 0, stdout: args[3] === "/work/alpha" ? "d\0src\0f\0a.txt\0" : "", stderr: "" };
    if (cmd === "wl-copy") return { code: 0, stdout: "", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
  const ex = h.load(MODS.explorer);
  await h.settle(); await h.settle();
  const press = async (...keys) => {
    for (const key of keys) fire(find(ex.render(), "files"), "on_key_down", { keystroke: key, key: key, key_char: key }, h.cx);
    await h.settle();
  };
  const copies = () => h.world.execs.filter(([cmd]) => cmd === "wl-copy").map(([, args]) => args);

  await press("c");
  assert.deepEqual(copies(), []);
  ok("c alone: copies nothing");

  await press("j");
  await press("c", "c");
  assert.deepEqual(copies(), [["--", "/work/alpha/a.txt"]]);
  assert.deepEqual(h.notes.at(-1), { title: "Copied path", body: "/work/alpha/a.txt", timeout: 2000 });
  ok("cc on a file: its full path to wl-copy, and a toast");

  await press("k", "c", "c");
  assert.deepEqual(copies().at(-1), ["--", "/work/alpha/src"]);
  ok("cc on a folder: its full path");

  h.world.exec = (cmd) => (cmd === "wl-copy" ? { code: 1, stdout: "", stderr: "no display" } : { code: 1, stdout: "", stderr: "" });
  await press("c", "c");
  await h.settle();
  assert.deepEqual(h.notes.at(-1), { title: "Could not copy path", body: "no display", level: "error" });
  ok("wl-copy fails: an error toast");

  noSpawnErrors();
})().catch((e) => { console.error(e); process.exit(1); });
