// The skills pane (mods/skills): the focused Claude Code agent's skills read from disk, grouped by whether the model
// sees them; follows the last focused agent; enter opens the SKILL.md. And <leader>as / <leader>aa in the sidebar.
const assert = require("node:assert/strict");
const { fakeHerdr, noSpawnErrors, MODS, find, fire, strings, plain } = require("./fake-herdr.cjs");

const ok = (name) => console.log(`  ok  ${name}`);
// What the mod's read prints: a SKILL.md's header, and a settings file.
const S = (scope, file, head) => `S\0${scope}\0${file}\0${head}\0`;
const O = (scope, settings) => `O\0${scope}\0${JSON.stringify(settings)}\0`;
const USER = "/home/me/.claude/skills";

(async () => {

  const h = fakeHerdr();
  h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }] });
  h.addPane({ pane: "p1", tab: "b1", terminal: "t1", status: "working", cwd: "/work/alpha/src" });
  h.addPane({ pane: "p2", tab: "b1", terminal: "t2", status: "idle", cwd: "/work/beta" });
  h.addPane({ pane: "p3", tab: "b1", terminal: "t3", status: "idle", cwd: "/work/alpha/src", program: { key: "pi", name: "pi", agent: true } });
  h.addPane({ pane: "px", tab: "b1", mod: "explorer" });
  h.focusPane("p1");
  const user = S("user", `${USER}/tdd/SKILL.md`, "name: tdd\ndescription: Test-driven development. Use it: test-first.\n")
    + S("user", `${USER}/grill-me/SKILL.md`, "name: grill-me\ndescription: \"Grill the user\"\ndisable-model-invocation: true\n")
    + S("user", `${USER}/brandkit/SKILL.md`, "name: brandkit\ndescription: >\n  Brand rules,\n  folded over lines.\n")
    + S("user", `${USER}/gone/SKILL.md`, "name: gone\ndescription: Switched off.\n")
    + S("user", `${USER}/quiet/SKILL.md`, "name: quiet\ndescription: Listed by name.\n")
    + S("user", `${USER}/no-header/SKILL.md`, "")
    + O("user", { skillOverrides: { brandkit: "user-invocable-only", gone: "off", quiet: "name-only", deploy: "user-invocable-only" } });
  const disk = {
    "/work/alpha/src": user + S("project", "/work/alpha/.claude/skills/deploy/SKILL.md", "name: deploy\ndescription: Ships it.\n")
      + S("project", "/work/alpha/.claude/skills/tdd/SKILL.md", "name: tdd\ndescription: The repo's own tdd.\n")
      + O("project", { skillOverrides: { gone: "on" } }) + O("local", { skillOverrides: { deploy: "on" } }),
    "/work/beta": user,
  };
  h.world.exec = (cmd, args) => {
    if (cmd === "sh" && args[2] === "skills") return disk[args[3]] != null ? { code: 0, stdout: disk[args[3]], stderr: "" } : { code: 1, stdout: "", stderr: "" };
    if (cmd === "omarchy-launch-editor") return { code: 0, stdout: "", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
  const node = (id) => { const f = (n) => n?.id === id ? n : (n?.children ?? []).map(f).find(Boolean); return f(h.world.layout); };
  const skills = h.load(MODS.skills);
  const settle = async () => { for (let i = 0; i < 4; i++) await h.settle(); };
  const draw = async () => { skills.render(); await settle(); return skills.render(); };
  const reads = () => h.world.execs.filter(([c]) => c === "sh");
  // The list as drawn: "== heading count" and "name" or "name [note]".
  const listed = async () => (find(await draw(), "skills-list").items.map((r) => { const s = strings(r); return r.id.startsWith("skills-h-") ? `== ${s.join(" ")}` : s.length > 1 ? `${s[0]} [${s[1]}]` : s[0]; }));
  const press = async (...keys) => { for (const key of keys) fire(find(skills.render(), "skills"), "on_key_down", { keystroke: key, key, key_char: key }, h.cx); await settle(); };

  assert.equal(node("sidebar-body").active, "agents");
  await draw();
  assert.deepEqual(reads(), []);
  ok("the agents list shown: reads nothing (Herdr keeps a hidden copy alive)");

  node("sidebar-body").active = "skills";
  assert.deepEqual(await listed(), [
    "== Model sees 5", "deploy [repo]", "gone", "no-header", "quiet [name only]", "tdd",
    "== Only you (/name) 2", "brandkit", "grill-me",
  ]);
  ok("a Claude Code agent: its skills by name, the ones the model sees first; the header's and the settings' say (local, then repo, then mine) decide");
  assert.deepEqual(plain(reads().map(([, a, o]) => [a[3], o])), [["/work/alpha/src", {}]]);
  await draw();
  assert.equal(reads().length, 1);
  ok("one read for the agent's folder, on its machine; drawing again reads nothing");

  await press("G");
  assert.ok(strings(find(await draw(), "skills-about")).includes("Grill the user"));
  await press("k");
  const about = strings(find(await draw(), "skills-about"));
  assert.ok(about.includes("Brand rules, folded over lines."), about.join(" | "));
  assert.ok(about.includes("~/.claude/skills/brandkit/SKILL.md"), about.join(" | "));
  await press("g", "g", "j", "j", "j", "j");
  assert.ok(strings(find(await draw(), "skills-about")).includes("Test-driven development. Use it: test-first."));
  ok("j/k, gg/G move; the row's description and file show under the list; my skill wins over the repo's of the same name");

  h.world.execs.length = 0;
  await press("enter");
  assert.deepEqual(plain(h.world.execs.map(([c, a]) => [c, a])), [["omarchy-launch-editor", [`${USER}/tdd/SKILL.md`]]]);
  ok("enter opens the SKILL.md in nvim");

  disk["/work/alpha/src"] = user;
  await press("r");
  assert.ok(!(await listed()).includes("deploy [repo]"));
  ok("r reads again");

  h.world.execs.length = 0;
  h.focusPane("p2");
  assert.deepEqual(await listed(), ["== Model sees 3", "no-header", "quiet [name only]", "tdd", "== Only you (/name) 2", "brandkit", "grill-me", "== Off 1", "gone"]);
  assert.deepEqual(plain(reads().map(([, a]) => a[3])), ["/work/beta"]);
  h.focusPane("px");
  assert.equal((await listed()).length, 9);
  ok("follows the focused agent; with a mod focused, keeps the last agent; a skill switched off is listed last");

  h.world.execs.length = 0;
  h.focusPane("p3");
  assert.ok(strings(await draw()).some((s) => /Claude Code only so far, not pi/.test(s)));
  assert.deepEqual(reads(), []);
  ok("another agent (pi): says its skills aren't read yet, reads nothing");

  // More skills than fit: only the lines that fit are drawn, and the cursor's line is one of them.
  {
    disk["/work/many"] = Array.from({ length: 60 }, (_, i) => S("user", `${USER}/s${String(i).padStart(2, "0")}/SKILL.md`, `description: Skill ${i}.\n`)).join("");
    h.addPane({ pane: "p4", tab: "b1", terminal: "t4", status: "idle", cwd: "/work/many" });
    h.focusPane("p4");
    const first = await listed();
    assert.ok(first.length < 30 && first[1] === "s00", first.join(","));
    await press("G");
    assert.equal((await listed()).at(-1), "s59");
    ok("a long list: draws what fits, moved to keep the cursor's line in view");
  }

  await press("q");
  assert.equal(node("sidebar-body").active, "agents");
  assert.deepEqual(plain(h.calls.at(-1)), ["pane.go", { direction: "left" }]);
  ok("q: back to the agents list, the keyboard to the terminals");

  // <leader>as: the skills pane in the agents list's place, with the keyboard; again, the list is back. <leader>aa from it too.
  {
    h.focusPane("p1");
    const bar = h.load(MODS.bufferline), leader = h.load(MODS.leader), list = h.load(MODS.agentsList);
    const leaderKey = async (...keys) => {
      h.command(MODS.bufferline, "leader"); await h.settle(); h.flushTimers(); await h.settle();
      for (const key of keys) fire(find(leader.render(), "leader"), "on_key_down", { key, key_char: key }, h.cx);
      await settle();
    };
    assert.notEqual(find(await draw(), "skills").style.border_color, "#accent");
    await leaderKey("a", "s");
    assert.equal(node("sidebar-body").active, "skills");
    assert.equal(find(await draw(), "skills").style.border_color, "#accent");
    ok("<leader>as: shows the skills pane and gives it the keyboard");
    await leaderKey("a", "s");
    assert.equal(node("sidebar-body").active, "agents"); assert.equal(node("sidebar").hidden ?? false, false);
    ok("<leader>as again: the agents list is back, the sidebar stays");
    await leaderKey("a", "s");
    h.takeCalls();
    await leaderKey("a", "a");
    assert.equal(node("sidebar-body").active, "agents"); assert.equal(node("sidebar").hidden ?? false, false);
    assert.ok(h.takeCalls().some(([name]) => name === "agents-list.focus"));
    ok("<leader>aa with the skills pane shown: the agents list, with the keyboard (the sidebar is not hidden)");
    node("sidebar").hidden = true;
    await leaderKey("a", "s");
    assert.equal(node("sidebar-body").active, "skills"); assert.equal(node("sidebar").hidden, false);
    ok("<leader>as with the sidebar hidden: shows it with the skills pane, and keeps it");
  }

  noSpawnErrors();
  console.log("skills: all passed");
})().catch((e) => { console.error(e); process.exit(1); });
