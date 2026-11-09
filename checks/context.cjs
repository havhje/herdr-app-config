// The context pane (mods/context): what is in the focused Claude Code agent's context and what each part costs. From
// its session's transcript: the parts (system prompt, tools, MCP, instructions, agent types, session notes), the
// skills loaded and the ones only described, their tokens, and the conversation as the rest of the real context; from
// disk the skills' files and the ones the model does not see. Parts unfold (all folded at first); follows the last focused agent; enter
// opens a row's file. And <leader>ac / <leader>aa in the sidebar.
const assert = require("node:assert/strict");
const { fakeHerdr, noSpawnErrors, MODS, find, fire, strings, plain } = require("./fake-herdr.cjs");

const ok = (name) => console.log(`  ok  ${name}`);
// What the mod's read prints: a SKILL.md's header, and a settings file.
const S = (scope, file, head) => `S\0${scope}\0${file}\0${head}\0`;
const O = (scope, settings) => `O\0${scope}\0${JSON.stringify(settings)}\0`;
// A session found for the terminal: its folder, its transcript's lines, the last turn's usage and the request as sent.
const T = (cwd, rows, usage = "", shape = null) => `T\0${cwd}\0${rows.map((r) => JSON.stringify(r)).join("\n")}\n\0U\0${usage}\0P\0${shape ? JSON.stringify({ type: "api-request-shape", shape }) : ""}\0`;
const NOTE = (attachment, chars) => ({ type: "attachment", attachment, ...(chars ? { rendered: [{ type: "text", content: "x".repeat(chars) }], renderedRole: "user" } : {}) });
const LISTING = (content, names) => NOTE({ type: "skill_listing", content, names });
const BODY = (dir, chars, byModel) => ({ type: "user", isMeta: true, ...(byModel ? { sourceToolUseID: "toolu_1" } : {}), message: { role: "user", content: [{ type: "text", text: `Base directory for this skill: ${dir}\n\n`.padEnd(chars, "x") }] } });
// A tool loaded after the start, that many characters as JSON.
const ADDED = (name, chars) => { const tool = { type: "custom", definition: { name, description: "" } }; tool.definition.description = "d".repeat(chars - JSON.stringify(tool).length); return { type: "tool_addition", tool }; };
// A tool's definition, that many characters as JSON.
const TOOL = (name, chars) => { const t = { name, description: "" }; t.description = "d".repeat(chars - JSON.stringify(t).length); return t; };
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
    if (cmd === "sh" && args[2] === "context") return disk[args[3]] != null ? { code: 0, stdout: disk[args[3]], stderr: "" } : { code: 1, stdout: "", stderr: "" };
    if (cmd === "omarchy-launch-editor") return { code: 0, stdout: "", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
  const node = (id) => { const f = (n) => n?.id === id ? n : (n?.children ?? []).map(f).find(Boolean); return f(h.world.layout); };
  const pane = h.load(MODS.context);
  const settle = async () => { for (let i = 0; i < 4; i++) await h.settle(); };
  const draw = async () => { pane.render(); await settle(); return pane.render(); };
  const reads = () => h.world.execs.filter(([c]) => c === "sh");
  // The list as drawn: "== part count" and, under an unfolded part, "name" or "name [note]"; with `true`, the tokens too ("name ~12", "== part count ~sum").
  const listed = async (costs = false) => (find(await draw(), "context-list").items.map((r) => {
    const s = strings(r).filter((x) => x && !/^[▸▾]$/.test(x)), cost = s.find((x, i) => i && /^~/.test(x)), note = s.slice(1).find((x) => !/^~/.test(x));
    return r.id.startsWith("context-h-") ? `== ${s[0]}${note ? ` ${note}` : ""}${costs && cost ? ` ${cost}` : ""}` : `${s[0]}${note ? ` [${note}]` : ""}${costs && cost ? ` ${cost}` : ""}`;
  }));
  const told = async () => strings(find(await draw(), "context-about"));
  const press = async (...keys) => { for (const key of keys) fire(find(pane.render(), "context"), "on_key_down", { keystroke: key, key, key_char: key }, h.cx); await settle(); };
  assert.equal(node("sidebar-body").active, "agents");
  await draw();
  assert.deepEqual(reads(), []);
  ok("the agents list shown: reads nothing (Herdr keeps a hidden copy alive)");

  node("sidebar-body").active = "context";
  assert.deepEqual(await listed(true), ["== Skills the model sees 5 ~30", "== Skills only you run (/name) 2"]);
  await press("enter");
  assert.deepEqual(await listed(true), [
    "== Skills the model sees 5 ~30", "tdd ~13", "gone ~6", "deploy [repo] ~5", "no-header ~4", "quiet [name only] ~2",
    "== Skills only you run (/name) 2",
  ]);
  assert.deepEqual(strings(find(await draw(), "context-sum")), ["~30 tokens", "no session found: loaded unknown"]);
  ok("no session found: the disk's skills, a folded line per kind; the ones the model sees with their descriptions' tokens (characters / 4), dearest first; the header's and the settings' say (local, then repo, then mine) decide");
  assert.deepEqual(plain(reads().map(([, a, o]) => [a[3], a[4], o])), [["/work/alpha/src", "t1", {}]]);
  await draw();
  assert.equal(reads().length, 1);
  ok("one read for the agent's folder and terminal, on its machine; drawing again reads nothing");

  assert.ok(strings(find(await draw(), "context-h-you")).includes("▸") && strings(find(await draw(), "context-h-model")).includes("▾"));
  await press("G", "enter");
  assert.deepEqual((await listed()).slice(-3), ["== Skills only you run (/name) 2", "brandkit", "grill-me"]);
  ok("enter on a folded part's line unfolds it");
  await press("G");
  assert.ok((await told()).includes("Grill the user"));
  await press("k");
  assert.ok((await told()).includes("Brand rules, folded over lines."), (await told()).join(" | "));
  assert.ok((await told()).includes("~/.claude/skills/brandkit/SKILL.md") && (await told()).includes("not in the context"), (await told()).join(" | "));
  await press("g", "g");
  assert.ok((await told()).includes("~30 tokens · 5 rows"), (await told()).join(" | "));
  await press("j");
  assert.ok((await told()).includes("Test-driven development. Use it: test-first."));
  assert.ok((await told()).includes("description ~13 · not loaded"));
  ok("j/k, gg/G move over parts and rows; the line's description, tokens and file show under the list; my skill wins over the repo's of the same name");

  h.world.execs.length = 0;
  await press("enter");
  assert.deepEqual(plain(h.world.execs), [["omarchy-launch-editor", [`${USER}/tdd/SKILL.md`], { cwd: "/work/alpha/src" }]]);
  h.world.execs.length = 0;
  await press("l");
  assert.deepEqual(plain(h.world.execs.map(([c, a]) => [c, a])), [["omarchy-launch-editor", [`${USER}/tdd/SKILL.md`]]]);
  ok("enter or l on a skill opens its SKILL.md in nvim (its own terminal window, as the explorer), started in the agent's folder");

  disk["/work/alpha/src"] = user;
  await press("r");
  assert.ok(!(await listed()).includes("deploy [repo]"));
  ok("r reads again");

  h.world.execs.length = 0;
  h.focusPane("p2");
  const beta = ["== Skills the model sees 3", "tdd", "no-header", "quiet [name only]", "== Skills only you run (/name) 2", "brandkit", "grill-me", "== Skills off 1"];
  assert.deepEqual(await listed(), beta);
  assert.deepEqual(plain(reads().map(([, a]) => a[3])), ["/work/beta"]);
  h.focusPane("px");
  assert.deepEqual(await listed(), beta);
  ok("follows the focused agent; with a mod focused, keeps the last agent; skills switched off are the last part, folded");

  h.world.execs.length = 0;
  h.focusPane("p3");
  assert.ok(strings(await draw()).some((s) => /Claude Code only so far, not pi/.test(s)));
  assert.deepEqual(reads(), []);
  ok("another agent (pi): says it isn't read yet, reads nothing");

  // More rows than fit: only the lines that fit are drawn, and the cursor's line is one of them.
  {
    disk["/work/many"] = Array.from({ length: 60 }, (_, i) => S("user", `${USER}/s${String(i).padStart(2, "0")}/SKILL.md`, `description: Skill ${i}.\n`)).join("");
    h.addPane({ pane: "p4", tab: "b1", terminal: "t4", status: "idle", cwd: "/work/many" });
    h.focusPane("p4");
    const first = await listed();
    assert.ok(first.length < 30 && first[1] === "s00", first.join(","));
    await press("G");
    assert.equal((await listed()).at(-1), "s59");
    ok("a long list: draws what fits, moved to keep the cursor's line in view");

    // The explorer's keys. 14 lines fit here, so half a page is 7.
    await press("ctrl-u");
    assert.ok((await told()).includes("Skill 52."), (await told()).join(" | "));
    await press("ctrl-d", "ctrl-d");
    assert.ok((await told()).includes("Skill 59."), (await told()).join(" | "));
    ok("ctrl-u and ctrl-d move half a page, stopping at the ends");
    await press("h");
    assert.ok((await told()).some((x) => x.endsWith("60 rows")), (await told()).join(" | "));
    await press("l");
    assert.ok((await told()).includes("Skill 0."), (await told()).join(" | "));
    ok("h on a row goes to its part's line; l on an unfolded part steps into it");
    await press("h", "h");
    assert.deepEqual(await listed(), ["== Skills the model sees 60"]);
    h.calls.length = 0;
    await press("h");
    assert.deepEqual(await listed(), ["== Skills the model sees 60"]);
    assert.deepEqual(h.calls, []);
    ok("h on an unfolded part's line folds it; on a folded one it does nothing (the keyboard stays)");
    await press("right");
    assert.equal((await listed())[1], "s00");
    await press("left", "left", "l");
    assert.equal((await listed())[1], "s00");
    await press("escape");
    assert.deepEqual(plain(h.calls.at(-1)), ["pane.go", { direction: "left" }]);
    ok("right and left as l and h; esc: the keyboard to the terminals");
  }

  // A session found: the whole context by part, from the request as sent and the notes attached; the skills from
  // the model's own listing (a plugin's too) and the bodies loaded.
  {
    const rows = [
      LISTING("- tdd: Test-driven development. Use it: test-first.\n- docs:pdf: Read PDFs.\n  - not a skill: a second line.\n- dataviz: Charts.", ["tdd", "docs:pdf", "dataviz"]),
      NOTE({ type: "instructions", files: [{ path: "/home/me/.claude/CLAUDE.md", type: "User", content: "i".repeat(1200) }] }, 1300),
      NOTE({ type: "nested_memory", path: "/work/real/CLAUDE.md", content: { path: "/work/real/CLAUDE.md", type: "Project", content: "n".repeat(400) } }, 450),
      NOTE({ type: "mcp_instructions_delta", addedNames: ["docs", "gone-server"], addedBlocks: ["## docs\n".padEnd(400, "m"), "x".repeat(4000)], removedNames: [] }, 4500),
      NOTE({ type: "mcp_instructions_delta", addedNames: [], addedBlocks: [], removedNames: ["gone-server"] }, 10),
      NOTE({ type: "deferred_tools_delta", addedNames: ["WebSearch", "mcp__docs__write"] }, 400),
      NOTE({ type: "agent_listing_delta", addedTypes: ["Explore"], addedLines: ["- Explore: Searches.".padEnd(200, " ")] }, 300),
      NOTE({ type: "environment", snapshot: {} }, 200),
      { type: "api-request-blob", message: { role: "system", content: [{ type: "text", text: "x" }, ADDED("mcp__docs__read", 800)] } },
      BODY(`${USER}/tdd`, 4000, true), BODY(`${USER}/grill-me`, 400, false), BODY("/plugins/cache/docs/skills/pdf", 2000, true), BODY("/plugins/cache/docs/skills/pdf", 2000, true),
    ];
    const shape = { system: [{ type: "text", text: "s".repeat(1000) }, { type: "text", text: "s".repeat(3000) }], tools: [TOOL("Bash", 2000)] };
    const usage = '"usage":{"input_tokens":2,"cache_creation_input_tokens":98,"cache_read_input_tokens":99900,"cache_creation":';
    disk["/work/sess"] = T("/work/real", rows, usage, shape) + user;
    h.addPane({ pane: "p5", tab: "b1", terminal: "vps/t5", status: "working", cwd: "/work/sess" });
    h.focusPane("p5");
    h.world.execs.length = 0;
    // A tall pane: every line fits.
    fire(find(pane.render(), "context"), "on_size_change", { height: 1400 }, h.cx);
    assert.deepEqual(await listed(true), [
      "== Conversation ~95.5k", "== System prompt ~1.0k", "== Tools 2 ~600", "== MCP 2 ~300", "== Instructions 2 ~400", "== Agent types 1 ~50", "== Session notes 1 ~50",
      "== Skills loaded 3 ~2.1k",
      "== Skills, description only 3 ~5", "dataviz ~5", "no-header", "quiet [name only]",
      "== Skills only you run (/name) 1", "brandkit", "== Skills off 1",
    ]);
    assert.deepEqual(plain(reads().map(([, a, o]) => [a[3], a[4], o])), [["/work/sess", "t5", { on: "vps" }]]);
    assert.deepEqual(strings(find(await draw(), "context-sum")), ["100k context", "skills ~2.1k · 2.1%"]);
    ok("a session found: a line per part of the context with its tokens, the conversation as the rest of the real context; then the skills, loaded ones first, from the model's own listing");

    const unfolded = async (label) => { const l = await listed(true), i = l.findIndex((x) => x.startsWith(`== ${label}`)); return l.slice(i + 1, l.findIndex((x, j) => j > i && x.startsWith("== "))); };
    await press("g", "g");
    assert.ok((await told()).includes("~95.5k tokens · 95.5%"), (await told()).join(" | "));
    await press("enter", "j", "j", "enter");
    assert.deepEqual(await unfolded("Tools"), ["Bash ~500", "names of deferred tools [2] ~100"]);
    assert.ok((await told()).includes("~600 tokens · 0.6% · 2 rows"), (await told()).join(" | "));
    await press("j", "j", "j", "enter");
    assert.deepEqual(await unfolded("MCP"), ["docs · read [tool] ~200", "docs [instructions] ~100"]);
    await press("j", "j", "j", "enter", "j");
    assert.deepEqual(await unfolded("Instructions"), ["~/.claude/CLAUDE.md [user] ~300", "/work/real/CLAUDE.md [project] ~100"]);
    assert.ok((await told()).includes("~300 tokens · 0.3%") && (await told()).includes("~/.claude/CLAUDE.md"), (await told()).join(" | "));
    h.world.execs.length = 0; h.notes.length = 0;
    await press("enter");
    assert.deepEqual(h.world.execs, []); assert.match(h.notes.at(-1).title, /another machine/);
    ok("a part unfolds to its rows: each tool, an MCP server's instructions and its loaded tools (a server taken away is gone), each instruction file; a file on another machine is not opened");
    await press("h", "h", "k", "h", "h", "k", "h", "h");
    assert.equal((await listed()).length, 15);

    await press("g", "g", "j", "j", "j", "j", "j", "j", "j", "enter");
    assert.deepEqual((await listed(true)).slice(7, 11), ["== Skills loaded 3 ~2.1k", "docs:pdf [plugin] ~1.0k", "tdd ~1.0k", "grill-me ~100"]);
    await press("j");
    const pdf = await told();
    assert.ok(pdf.some((x) => /^Read PDFs\.\s+- not a skill: a second line\.$/.test(x)), pdf.join(" | "));
    assert.ok(pdf.includes("description ~14 · body ~1.0k (×2) · the model loaded it"), pdf.join(" | "));
    h.world.execs.length = 0; h.notes.length = 0;
    await press("enter");
    assert.ok(pdf.includes("/plugins/cache/docs/skills/pdf/SKILL.md"), pdf.join(" | "));
    assert.deepEqual(h.world.execs, []); assert.match(h.notes.at(-1).title, /another machine/);
    await press("j");
    assert.ok((await told()).includes("description ~13 · body ~1.0k · the model loaded it"));
    await press("j");
    assert.ok((await told()).includes("body ~100 · you ran it"));
    ok("the loaded skills unfolded (description + body): a skill's tokens part by part and who loaded it; a plugin's loaded skill has its file, from the folder its body names");
    h.notes.length = 0;
    await press("g", "g", "j", "j", "l", "l", "enter");
    assert.deepEqual(h.world.execs, []); assert.match(h.notes.at(-1).title, /No file known for Bash/);
    await press("h", "h");
    ok("a row that is no file (a tool) says so");

    h.world.execs.length = 0;
    rows.push(BODY("/work/real/.claude/skills/deploy", 800, true));
    disk["/work/sess"] = T("/work/real", rows, usage, shape) + user;
    await draw();
    assert.equal(reads().length, 0);
    h.setStatus("vps/t5", "idle");
    assert.ok((await listed(true)).includes("deploy ~200"));
    assert.equal(reads().length, 1);
    ok("the followed agent stops working: read again (a turn may have loaded a skill)");

    // Compaction drops the bodies and the notes before it; the bodies Claude Code kept are counted, and a note not sent again stays.
    disk["/work/sess"] = T("/work/real", [rows[0], rows[9], NOTE({ type: "environment" }, 4000), { type: "system", subtype: "compact_boundary" }, NOTE({ type: "environment" }, 200),
      NOTE({ type: "invoked_skills", skills: [{ name: "grill-me", path: "userSettings:grill-me", content: "x".repeat(800) }] })], '"usage":{"input_tokens":50000') + user;
    await press("r");
    assert.deepEqual((await listed(true)).slice(0, 5), ["== Conversation ~49.7k", "== Session notes 1 ~50", "== Skills loaded 1 ~200", "grill-me ~200", "== Skills, description only 5 ~32"]);
    assert.deepEqual(strings(find(await draw(), "context-sum")), ["50.0k context", "skills ~232 · 0.5% · compacted"]);
    ok("after a compaction: only the bodies kept through it are loaded, and the notes sent again replace the old");

    disk["/work/sess"] = T("/work/real", []) + user;
    await press("r");
    assert.deepEqual(strings(find(await draw(), "context-sum")), ["~19 tokens", "no turn yet: loaded unknown"]);
    ok("a session with no turn yet: the disk's skills, estimated");
  }

  await press("q");
  assert.equal(node("sidebar-body").active, "agents");
  assert.deepEqual(plain(h.calls.at(-1)), ["pane.go", { direction: "left" }]);
  ok("q: back to the agents list, the keyboard to the terminals");

  // <leader>ac: the context pane in the agents list's place, with the keyboard; again, the list is back. <leader>aa from it too.
  {
    h.focusPane("p1");
    const bar = h.load(MODS.bufferline), leader = h.load(MODS.leader), list = h.load(MODS.agentsList);
    const leaderKey = async (...keys) => {
      h.command(MODS.bufferline, "leader"); await h.settle(); h.flushTimers(); await h.settle();
      for (const key of keys) fire(find(leader.render(), "leader"), "on_key_down", { key, key_char: key }, h.cx);
      await settle();
    };
    assert.notEqual(find(await draw(), "context").style.border_color, "#accent");
    await leaderKey("a", "c");
    assert.equal(node("sidebar-body").active, "context");
    assert.equal(find(await draw(), "context").style.border_color, "#accent");
    ok("<leader>ac: shows the context pane and gives it the keyboard");
    await leaderKey("a", "c");
    assert.equal(node("sidebar-body").active, "agents"); assert.equal(node("sidebar").hidden ?? false, false);
    ok("<leader>ac again: the agents list is back, the sidebar stays");
    await leaderKey("a", "c");
    h.takeCalls();
    await leaderKey("a", "a");
    assert.equal(node("sidebar-body").active, "agents"); assert.equal(node("sidebar").hidden ?? false, false);
    assert.ok(h.takeCalls().some(([name]) => name === "agents-list.focus"));
    ok("<leader>aa with the context pane shown: the agents list, with the keyboard (the sidebar is not hidden)");
    node("sidebar").hidden = true;
    await leaderKey("a", "c");
    assert.equal(node("sidebar-body").active, "context"); assert.equal(node("sidebar").hidden, false);
    ok("<leader>ac with the sidebar hidden: shows it with the context pane, and keeps it");
  }

  noSpawnErrors();
  console.log("context: all passed");
})().catch((e) => { console.error(e); process.exit(1); });
