// The context pane (mods/context): what is in the focused agent's context and what each part costs, as a tree by
// whose it is: the agent (everything its own or only working there, gone with another agent), split in what I can
// change (its tools, own skills and MCP servers) and what is fixed (system prompt; for Claude Code agent types and
// session notes); my setup (my skills by who starts them: automatic, manual, off; instructions; my MCP servers,
// tools and agent types) and last the conversation, the rest of the real context. For Claude Code from its session's
// transcript and, for the skills' files and the ones the model does not see, from disk; for Pi from its session
// file's system messages; for Codex from what it prints as a new session's start, its system prompt, tools and
// context size named as not readable. The dearest first at every level; parts unfold; follows the last focused agent; the
// explorer's keys; enter opens a row's file. And <leader>ac / <leader>aa in the sidebar.
const assert = require("node:assert/strict");
const { fakeHerdr, noSpawnErrors, MODS, find, fire, strings, plain } = require("./fake-herdr.cjs");

const ok = (name) => console.log(`  ok  ${name}`);
// What the mod's read prints: a SKILL.md's header (scope shared: ~/.agents/skills has that skill; user: only the
// agent's own folder has it; project: a repo's), and a settings file.
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
  h.addPane({ pane: "p3", tab: "b1", terminal: "t3", status: "idle", cwd: "/work/alpha/src", program: { key: "opencode", name: "opencode", agent: true } });
  h.addPane({ pane: "px", tab: "b1", mod: "explorer" });
  h.focusPane("p1");
  const user = S("shared", `${USER}/tdd/SKILL.md`, "name: tdd\ndescription: Test-driven development. Use it: test-first.\n")
    + S("shared", `${USER}/grill-me/SKILL.md`, "name: grill-me\ndescription: \"Grill the user\"\ndisable-model-invocation: true\n")
    + S("shared", `${USER}/brandkit/SKILL.md`, "name: brandkit\ndescription: >\n  Brand rules,\n  folded over lines.\n")
    + S("shared", `${USER}/gone/SKILL.md`, "name: gone\ndescription: Switched off.\n")
    + S("shared", `${USER}/quiet/SKILL.md`, "name: quiet\ndescription: Listed by name.\n")
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
    const s = strings(r).filter((x) => x && !/^[▸▾]$|%$/.test(x)), cost = s.find((x, i) => i && /^~/.test(x)), note = s.slice(1).find((x) => !/^~/.test(x));
    return r.id.startsWith("context-h-") ? `== ${s[0]}${note ? ` ${note}` : ""}${costs && cost ? ` ${cost}` : ""}` : `${s[0]}${note ? ` [${note}]` : ""}${costs && cost ? ` ${cost}` : ""}`;
  }));
  const told = async () => strings(find(await draw(), "context-about"));
  const press = async (...keys) => { for (const key of keys) fire(find(pane.render(), "context"), "on_key_down", { keystroke: key, key, key_char: key }, h.cx); await settle(); };
  assert.equal(node("sidebar-body").active, "agents");
  await draw();
  assert.deepEqual(reads(), []);
  ok("the agents list shown: reads nothing (Herdr keeps a hidden copy alive)");

  node("sidebar-body").active = "context";
  // The cursor on a line, by its id (the keys down to it).
  const at = async (id) => { pane.view.cursor = id; await draw(); };
  // The rows drawn under a part's line (the first so named, or the first after a top part's line).
  const under = async (label, group) => { const l = await listed(true), from = group ? l.findIndex((x) => x.startsWith(`== ${group}`)) : -1, i = l.findIndex((x, j) => j > from && x.startsWith(`== ${label}`)), end = l.findIndex((x, j) => j > i && x.startsWith("== ")); return l.slice(i + 1, end < 0 ? l.length : end); };
  assert.deepEqual(await listed(true), ["== Your setup 7 ~30", "== Skills 7 ~30", "== Automatic 5 ~30", "== Manual (/name) 2"]);
  await at("setup/skills/auto");
  await press("enter");
  assert.deepEqual(await listed(true), [
    "== Your setup 7 ~30", "== Skills 7 ~30",
    "== Automatic 5 ~30", "tdd ~13", "gone ~6", "deploy [repo] ~5", "no-header [claude only] ~4", "quiet [name only] ~2",
    "== Manual (/name) 2",
  ]);
  assert.deepEqual(strings(find(await draw(), "context-sum")), ["~30 tokens", "no session found: loaded unknown"]);
  ok("no session found: the disk's skills under my setup, split by who starts them: automatic ones with their descriptions' tokens (characters / 4), dearest first, and manual ones; the header's and the settings' say (local, then repo, then mine) decide; one not in the shared ~/.agents/skills is marked");
  assert.deepEqual(plain(reads().map(([, a, o]) => [a[3], a[4], a[5], o])), [["/work/alpha/src", "t1", "claude", {}]]);
  await draw();
  assert.equal(reads().length, 1);
  ok("one read for the agent's folder, terminal and kind, on its machine; drawing again reads nothing");

  assert.ok(strings(find(await draw(), "context-h-setup/skills/manual")).includes("▸") && strings(find(await draw(), "context-h-setup/skills/auto")).includes("▾"));
  await press("G", "enter");
  assert.deepEqual((await listed()).slice(-3), ["== Manual (/name) 2", "brandkit", "grill-me"]);
  ok("enter on a folded part's line unfolds it");
  await press("G");
  assert.ok((await told()).includes("Grill the user"));
  await press("k");
  assert.ok((await told()).includes("Brand rules, folded over lines."), (await told()).join(" | "));
  assert.ok((await told()).includes("~/.claude/skills/brandkit/SKILL.md") && (await told()).includes("not in the context"), (await told()).join(" | "));
  await press("g", "g");
  assert.ok((await told()).includes("~30 tokens · 7 rows"), (await told()).join(" | "));
  await press("j", "j", "j");
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
  const beta = ["== Your setup 6", "== Skills 6", "== Automatic 3", "tdd", "no-header [claude only]", "quiet [name only]", "== Manual (/name) 2", "brandkit", "grill-me", "== Off 1"];
  assert.deepEqual(await listed(), beta);
  assert.deepEqual(plain(reads().map(([, a]) => [a[3], a[4]])), [["/work/beta", "t2"]]);
  h.focusPane("px");
  assert.deepEqual(await listed(), beta);
  ok("follows the focused agent; with a mod focused, keeps the last agent; skills switched off are the last kind, folded");

  h.world.execs.length = 0;
  h.focusPane("p3");
  assert.ok(strings(await draw()).some((s) => /Claude Code, Pi, Codex only so far, not opencode/.test(s)));
  assert.deepEqual(reads(), []);
  ok("another agent (opencode): says it isn't read yet, reads nothing");

  // More rows than fit: only the lines that fit are drawn, and the cursor's line is one of them.
  {
    disk["/work/many"] = Array.from({ length: 60 }, (_, i) => S("shared", `${USER}/s${String(i).padStart(2, "0")}/SKILL.md`, `description: Skill ${i}.\n`)).join("");
    h.addPane({ pane: "p4", tab: "b1", terminal: "t4", status: "idle", cwd: "/work/many" });
    h.focusPane("p4");
    const first = await listed();
    assert.ok(first.length < 30 && first[3] === "s00", first.join(","));
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
    assert.ok((await told()).some((x) => x.endsWith("60 rows")) && (await told()).some((x) => x.startsWith("Skills the agent may load by itself")), (await told()).join(" | "));
    await press("l");
    assert.ok((await told()).includes("Skill 0."), (await told()).join(" | "));
    ok("h on a row goes to its part's line; l on an unfolded part steps into it");
    await press("h", "h");
    assert.deepEqual(await listed(), ["== Your setup 60", "== Skills 60", "== Automatic 60"]);
    await press("h");
    assert.ok((await told()).some((x) => x.startsWith("My skills")), (await told()).join(" | "));
    ok("h on an unfolded part's line folds it; on a folded one it goes to the part it is in");
    h.calls.length = 0;
    await press("h", "h", "h");
    assert.deepEqual(await listed(), ["== Your setup 60"]);
    await press("h");
    assert.deepEqual(await listed(), ["== Your setup 60"]);
    assert.deepEqual(h.calls, []);
    ok("h on a folded top part does nothing (the keyboard stays)");
    await press("right", "right", "l", "l", "l");
    assert.equal((await listed())[3], "s00");
    await press("left", "left");
    assert.deepEqual(await listed(), ["== Your setup 60", "== Skills 60", "== Automatic 60"]);
    await press("escape");
    assert.deepEqual(plain(h.calls.at(-1)), ["pane.go", { direction: "left" }]);
    ok("right and left as l and h; esc: the keyboard to the terminals");
  }

  // A session found: the whole context as a tree, from the request as sent and the notes attached; the skills from
  // the model's own listing and the bodies loaded. Claude Code's own apart from mine: the skills not in a skills
  // folder of mine (a plugin's, a built-in one, one synced from the Claude account), the claude.ai connectors and
  // Claude in Chrome, the built-in agent types.
  {
    const rows = [
      LISTING("- tdd: Test-driven development. Use it: test-first.\n- docs:pdf: Read PDFs.\n  - not a skill: a second line.\n- dataviz: Charts.", ["tdd", "docs:pdf", "dataviz"]),
      NOTE({ type: "instructions", files: [{ path: "/home/me/.claude/CLAUDE.md", type: "User", content: "i".repeat(1200) }] }, 1300),
      NOTE({ type: "nested_memory", path: "/work/real/CLAUDE.md", content: { path: "/work/real/CLAUDE.md", type: "Project", content: "n".repeat(400) } }, 450),
      NOTE({ type: "mcp_instructions_delta", addedNames: ["my docs", "gone-server", "claude.ai Gmail"], addedBlocks: ["## my docs\n".padEnd(400, "m"), "x".repeat(4000), "## claude.ai Gmail\n".padEnd(600, "g")], removedNames: [] }, 5100),
      NOTE({ type: "mcp_instructions_delta", addedNames: [], addedBlocks: [], removedNames: ["gone-server"] }, 10),
      NOTE({ type: "deferred_tools_delta", addedNames: ["WebSearch", "mcp__my_docs__write", "mcp__mail__send", "mcp__claude-in-chrome__navigate", "mcp__claude_ai_Gmail__send"] }, 400),
      NOTE({ type: "agent_listing_delta", addedTypes: ["Explore", "reviewer"], addedLines: ["- Explore: Searches.".padEnd(200, " "), "- reviewer: Reviews.".padEnd(120, " ")], builtInTypes: ["Explore"] }, 400),
      NOTE({ type: "environment", snapshot: {} }, 200),
      { type: "api-request-blob", message: { role: "system", content: [{ type: "text", text: "x" }, ADDED("mcp__my_docs__read", 800)] } },
      BODY(`${USER}/tdd`, 4000, true), BODY(`${USER}/grill-me`, 400, false), BODY("/plugins/cache/docs/skills/pdf", 2000, true), BODY("/plugins/cache/docs/skills/pdf", 2000, true),
      BODY(`${USER}/synced/account/docx`, 400, false),
    ];
    const shape = { system: [{ type: "text", text: "s".repeat(1000) }, { type: "text", text: "s".repeat(3000) }], tools: [TOOL("Bash", 2000)] };
    const usage = '"usage":{"input_tokens":2,"cache_creation_input_tokens":98,"cache_read_input_tokens":99900,"cache_creation":';
    disk["/work/sess"] = T("/work/real", rows, usage, shape) + user;
    h.addPane({ pane: "p5", tab: "b1", terminal: "vps/t5", status: "working", cwd: "/work/sess" });
    h.focusPane("p5");
    h.world.execs.length = 0;
    // A tall pane: every line fits.
    fire(find(pane.render(), "context"), "on_size_change", { height: 1400 }, h.cx);
    // Folded again, as at first: the manual skills, unfolded above.
    await draw(); await at("setup/skills/manual"); await press("h");
    const whole = [
      "== Claude Code 10 ~3.0k",
      "== Configurable 8 ~1.9k", "== Skills 3 ~1.1k", "== Tools 2 ~576", "== MCP 3 ~165",
      "== Fixed 2 ~1.1k", "== System prompt ~1.0k", "== Agent types 1 ~50", "== Session notes 1 ~50",
      "== Your setup 13 ~1.9k",
      "== Skills 6 ~1.1k", "== Automatic 3 ~1.0k", "== Manual (/name) 2 ~100", "== Off 1",
      "== Instructions 2 ~400", "== MCP 4 ~309", "== Agent types 1 ~30",
      "== Conversation ~95.2k",
    ];
    assert.deepEqual(await listed(true), whole);
    assert.deepEqual(plain(reads().map(([, a, o]) => [a[3], a[4], a[5], o])), [["/work/sess", "t5", "claude", { on: "vps" }]]);
    assert.deepEqual(strings(find(await draw(), "context-sum")), ["100k context", "~4.8k without conversation"]);
    assert.deepEqual(["setup", "setup/skills/manual", "agent/can/tools", "talk"].map((id) => strings(find(pane.render(), `context-h-${id}`)).at(-1)), ["2%", "<1%", "1%", "95%"]);
    ok("a session found: a tree by whose it is, the dearest first at every level: Claude Code (what I can change: its tools, skills and MCP servers; what is fixed: system prompt, agent types, session notes), my setup, each part with its tokens and its share; last the conversation, the rest of the real context");

    await at("talk");
    assert.ok((await told()).includes("~95.2k tokens · 95.2%"), (await told()).join(" | "));
    await press("l");
    assert.deepEqual(await listed(true), whole);
    await at("agent/can/tools"); await press("l");
    assert.deepEqual(await under("Tools"), ["Bash ~500", "names of deferred tools [1] ~76"]);
    assert.ok((await told()).includes("~576 tokens · 0.6% · 2 rows"), (await told()).join(" | "));
    await at("setup/mcp"); await press("l", "l", "l");
    const servers = async () => (await listed(true)).filter((x) => /^== (my docs|mail|claude)/.test(x));
    assert.deepEqual(await servers(), ["== my docs 3 ~305", "== mail 1 ~4"]);
    assert.deepEqual(await under("my docs"), ["read [tool] ~200", "instructions ~100", "names of deferred tools [1] ~5"]);
    await at("agent/can/mcp"); await press("l", "l", "l");
    assert.deepEqual(await servers(), ["== claude.ai Gmail 2 ~157", "== claude-in-chrome 1 ~8", "== my docs 3 ~305", "== mail 1 ~4"]);
    assert.deepEqual(await under("claude.ai Gmail"), ["instructions ~150", "names of deferred tools [1] ~7"]);
    await press("h", "h", "h");
    ok("MCP by whose: the claude.ai connectors and Claude in Chrome under Claude Code (configurable), the servers I set up under my setup");
    await at("agent/fixed/agents"); await press("l"); await at("setup/agents"); await press("l");
    assert.deepEqual((await listed(true)).filter((x) => /^(Explore|reviewer)/.test(x)), ["Explore ~50", "reviewer ~30"]);
    await press("h"); await at("agent/fixed/agents"); await press("h");
    ok("agent types by whose: the built-in ones under Claude Code (fixed), the ones I added under my setup");
    await at("setup/instructions"); await press("l", "l");
    assert.deepEqual(await under("Instructions"), ["~/.claude/CLAUDE.md [user] ~300", "/work/real/CLAUDE.md [project] ~100"]);
    assert.ok((await told()).includes("~300 tokens · 0.3%") && (await told()).includes("~/.claude/CLAUDE.md"), (await told()).join(" | "));
    h.world.execs.length = 0; h.notes.length = 0;
    await press("enter");
    assert.deepEqual(h.world.execs, []); assert.match(h.notes.at(-1).title, /another machine/);
    ok("a part unfolds to its rows: each instruction file; a file on another machine is not opened");
    h.notes.length = 0;
    await at("agent/can/tools"); await press("l", "enter");
    assert.deepEqual(h.world.execs, []); assert.match(h.notes.at(-1).title, /No file known for Bash/);
    ok("a row that is no file (a tool) says so");
    await press("h", "h"); await at("setup/instructions"); await press("h"); await at("setup/mcp/my_docs"); await press("h", "h", "h");
    assert.deepEqual(await listed(true), whole);

    await at("setup/skills/auto"); await press("l");
    assert.deepEqual(await under("Automatic"), ["tdd [loaded] ~1.0k", "no-header [claude only]", "quiet [name only]"]);
    await press("l");
    assert.ok((await told()).includes("description ~13 · body ~1.0k · the model loaded it"));
    await at("setup/skills/manual"); await press("l");
    assert.deepEqual(await under("Manual"), ["grill-me [loaded] ~100", "brandkit"]);
    await press("l");
    assert.ok((await told()).includes("body ~100 · you ran it"));
    await press("h", "h");
    ok("my skills by who starts them: automatic (the description, and the body once loaded) and manual (nothing until I run one); a loaded one is marked, with its tokens part by part and who loaded it");

    const EXTRAS = "Configurable";
    await at("agent/can/skills"); await press("l");
    assert.deepEqual((await listed(true)).slice(2, 5), ["== Skills 3 ~1.1k", "== Automatic 2 ~1.0k", "== Manual (/name) 1 ~100"]);
    await at("agent/can/skills/manual"); await press("l");
    assert.deepEqual(await under("Manual", EXTRAS), ["docx [loaded] ~100"]);
    await press("h"); await at("agent/can/skills/auto"); await press("l");
    assert.deepEqual(await under("Automatic", EXTRAS), ["docs:pdf [plugin · loaded] ~1.0k", "dataviz ~5"]);
    await press("l");
    const pdf = await told();
    assert.ok(pdf.some((x) => /^Read PDFs\.\s+- not a skill: a second line\.$/.test(x)), pdf.join(" | "));
    assert.ok(pdf.includes("description ~14 · body ~1.0k (×2) · the model loaded it"), pdf.join(" | "));
    assert.ok(pdf.includes("/plugins/cache/docs/skills/pdf/SKILL.md"), pdf.join(" | "));
    h.world.execs.length = 0; h.notes.length = 0;
    await press("enter");
    assert.deepEqual(h.world.execs, []); assert.match(h.notes.at(-1).title, /another machine/);
    await press("h", "h"); await at("agent/can/skills"); await press("h");
    ok("Claude Code's skills apart from mine: the listed ones not in a skills folder of mine (a plugin's, a built-in one) and one synced from the Claude account that I ran; a plugin's loaded skill has its file, from the folder its body names");

    h.world.execs.length = 0;
    rows.push(BODY("/work/real/.claude/skills/deploy", 800, true));
    disk["/work/sess"] = T("/work/real", rows, usage, shape) + user;
    await draw();
    assert.equal(reads().length, 0);
    h.setStatus("vps/t5", "idle");
    assert.ok((await listed(true)).includes("deploy [loaded] ~200"));
    assert.equal(reads().length, 1);
    ok("the followed agent stops working: read again (a turn may have loaded a skill)");
    await at("setup/skills/auto"); await press("h");

    // Compaction drops the bodies and the notes before it; the bodies Claude Code kept are counted, and a note not sent again stays.
    disk["/work/sess"] = T("/work/real", [rows[0], rows[9], NOTE({ type: "environment" }, 4000), { type: "system", subtype: "compact_boundary" }, NOTE({ type: "environment" }, 200),
      NOTE({ type: "invoked_skills", skills: [{ name: "grill-me", path: "userSettings:grill-me", content: "x".repeat(800) }, { name: "init", path: "bundled:init", content: "x".repeat(400) }] })], '"usage":{"input_tokens":50000') + user;
    await press("r");
    assert.deepEqual(await listed(true), ["== Your setup 6 ~213", "== Skills 6 ~213", "== Manual (/name) 2 ~200", "== Automatic 3 ~13", "== Off 1", "== Claude Code 4 ~169", "== Configurable 3 ~119", "== Skills 3 ~119", "== Fixed 1 ~50", "== Session notes 1 ~50", "== Conversation ~49.6k"]);
    assert.deepEqual(strings(find(await draw(), "context-sum")), ["50.0k context", "~382 without conversation · compacted"]);
    ok("after a compaction: only the bodies kept through it are loaded (a bundled one is Claude Code's), and the notes sent again replace the old");

    disk["/work/sess"] = T("/work/real", []) + user;
    await press("r");
    assert.deepEqual(strings(find(await draw(), "context-sum")), ["~19 tokens", "no turn yet: loaded unknown"]);
    ok("a session with no turn yet: the disk's skills, estimated");
  }

  // Pi: the same tree from its session file's system messages. Its built-in tools and its own wording are Pi's own;
  // the skills it was started with, the instruction files, the MCP servers named and the extensions' tools are mine.
  {
    const AG = "/home/me/.agents/skills", MINE = "/home/me/.pi/agent/skills";
    // A skill as Pi lists it, that many characters.
    const LISTED = (name, file, chars) => { const end = `</description>\n    <location>${file}</location>\n  </skill>`; return `<skill>\n    <name>${name}</name>\n    <description>`.padEnd(chars - end.length, "d") + end; };
    const SYSTEM = (sections, toolsAdded) => ({ type: "message", message: { role: "system", content: "", sections, toolsAdded } });
    const B = (how, file, bytes) => `B\0${how}\0${file}\0${bytes}\0`;
    const rows = [
      SYSTEM({
        preamble: "p".repeat(400), rules: "r".repeat(200), tools: "t".repeat(120),
        skills: "<skills>\n".padEnd(80, " ") + LISTED("tdd", `${AG}/tdd/SKILL.md`, 400) + LISTED("notes", `${MINE}/notes/SKILL.md`, 200),
        project_context: (`<project_instructions path="/work/pi/AGENTS.md">\n${"a".repeat(800)}</project_instructions>`).padEnd(880, " "),
        mcp_servers: "- mcp__zotero (codemode): Papers.".padEnd(40, " "),
      }, [TOOL("read", 400), TOOL("bg_wait", 800)]),
      SYSTEM({ tools: "t".repeat(160) }, [TOOL("web_search", 400)]),
    ];
    const skills = S("shared", `${AG}/tdd/SKILL.md`, "name: tdd\ndescription: T.\n") + S("shared", `${AG}/grill-me/SKILL.md`, "name: grill-me\ndescription: G.\ndisable-model-invocation: true\n")
      + S("user", `${MINE}/notes/SKILL.md`, "name: notes\ndescription: N.\n");
    const PI = (lines) => `I\0/work/pi\0${lines.map((r) => JSON.stringify(r)).join("\n")}\n\0U\0"usage":{"input":1000,"output":5,"cacheRead":19000,"cacheWrite":0,"reasoning":0,\0`
      + B("model", `${AG}/tdd/SKILL.md`, 2000) + B("you", `${AG}/grill-me/SKILL.md`, 400) + skills;
    disk["/work/pi"] = PI(rows);
    h.addPane({ pane: "p6", tab: "b1", terminal: "t6", status: "idle", cwd: "/work/pi", program: { key: "pi", name: "pi", agent: true } });
    h.world.execs.length = 0;
    h.focusPane("p6");
    assert.deepEqual(await listed(true), [
      "== Your setup 7 ~1.3k",
      "== Skills 3 ~750", "== Automatic 2 ~650", "== Manual (/name) 1 ~100",
      "== Extension tools 2 ~300", "== Instructions 1 ~200", "== MCP 1 ~10",
      "== Pi 5 ~330",
      "== Fixed 4 ~230", "== System prompt 4 ~230", "== Configurable 1 ~100", "== Tools 1 ~100",
      "== Conversation ~18.4k",
    ]);
    assert.deepEqual(plain(reads().map(([, a, o]) => [a[3], a[4], a[5], o])), [["/work/pi", "t6", "pi", {}]]);
    assert.deepEqual(strings(find(await draw(), "context-sum")), ["20.0k context", "~1.6k without conversation"]);
    ok("Pi: the same tree from its session file: my setup (skills, the extensions' tools, instructions, MCP), Pi (fixed: system prompt; configurable: built-in tools); last the conversation");

    await at("setup/skills/auto"); await press("l");
    assert.deepEqual(await under("Automatic"), ["tdd [loaded] ~600", "notes [pi only] ~50"]);
    await press("l");
    assert.ok((await told()).includes("description ~100 · body ~500 · the model loaded it"), (await told()).join(" | "));
    assert.ok((await told()).includes("~/.agents/skills/tdd/SKILL.md"), (await told()).join(" | "));
    await at("setup/skills/manual"); await press("l");
    assert.deepEqual(await under("Manual"), ["grill-me [loaded] ~100"]);
    await press("l");
    assert.ok((await told()).includes("body ~100 · you ran it"), (await told()).join(" | "));
    await press("h", "h"); await at("setup/skills/auto"); await press("h");
    ok("Pi's skills: the listed ones automatic, a hidden one manual; one read by the model or run by me is loaded, its size the file's; one not in the shared ~/.agents/skills is marked");

    await at("agent/fixed/system"); await press("l");
    assert.deepEqual(await under("System prompt"), ["preamble ~100", "rules ~50", "around my setup ~40", "tool list ~40"]);
    await press("h"); await at("setup/tools"); await press("l");
    assert.deepEqual(await under("Extension tools"), ["bg_wait ~200", "web_search ~100"]);
    await press("h"); await at("setup/mcp"); await press("l");
    assert.deepEqual(await under("MCP"), ["zotero [codemode] ~10"]);
    await press("h"); await at("setup/instructions"); await press("l");
    assert.deepEqual(await under("Instructions"), ["/work/pi/AGENTS.md ~200"]);
    await press("h");
    ok("Pi's parts unfold: the system prompt by section (a later message's section replaces the first), each tool (a later message's are added), each MCP server, each instruction file");

    disk["/work/pi"] = PI([...rows, { type: "compaction" }]);
    await press("r");
    assert.deepEqual(strings(find(await draw(), "context-sum")), ["20.0k context", "~1.6k without conversation · compacted"]);
    disk["/work/pi"] = "";
    await press("r");
    assert.ok(strings(find(await draw(), "context-list")).includes("Nothing found"));
    assert.deepEqual(strings(find(await draw(), "context-sum")), ["~0 tokens", "no session found: loaded unknown"]);
    ok("Pi: a compaction is told; no pi process found for the terminal: nothing");
  }

  // Codex: it keeps no record of what a session sent. My setup and its own skills and notes from what it prints as a
  // new session's start in the folder; its system prompt, tools and the conversation named as not readable.
  {
    const ROOTS = "<skills_instructions>\n### Skill roots\n- `r0` = `/home/me/.codex/skills`\n- `r1` = `/home/me/.agents/skills`\n- `r2` = `/home/me/.codex/skills/.system`\n### Available skills\n";
    // A skill as Codex lists it, that many characters.
    const LISTED = (name, root, chars) => { const end = ` (file: ${root}/${name}/SKILL.md)`; return `- ${name}: `.padEnd(chars - end.length, "d") + end; };
    const MESSAGE = (role, pieces) => ({ type: "message", role, content: pieces.map(([, text]) => ({ type: "input_text", text })), internal_chat_message_metadata_passthrough: { content_item_kinds: pieces.map(([kind]) => kind) } });
    const said = [
      MESSAGE("developer", [
        ["host_skills.instructions", (ROOTS + [LISTED("tdd", "r1", 400), LISTED("notes", "r0", 200), LISTED("imagegen", "r2", 400)].join("\n") + "\n</skills_instructions>").padEnd(1400, " ")],
        ["permissions.instructions", "p".repeat(400)]]),
      MESSAGE("user", [["agents_md.instructions", "# AGENTS.md instructions for /work/cx\n".padEnd(800, "a")], ["environments.environment_context", "e".repeat(200)]]),
    ];
    disk["/work/cx"] = `X\0/work/cx\0${JSON.stringify(said, null, 2)}\0A\0tdd\ngrill-me\n\0B\0model\0/home/me/.agents/skills/tdd/SKILL.md\x002000\0`;
    h.addPane({ pane: "p7", tab: "b1", terminal: "t7", status: "idle", cwd: "/work/cx", program: { key: "codex", name: "codex", agent: true } });
    h.world.execs.length = 0;
    h.focusPane("p7");
    assert.deepEqual(await listed(true), [
      "== Your setup 3 ~850",
      "== Skills 2 ~650", "== Automatic 2 ~650", "== Instructions 1 ~200",
      "== Codex 7 ~350",
      "== Fixed 3 ~250", "== Session notes 3 ~250", "== Configurable 1 ~100", "== Skills 1 ~100", "== Not readable 3",
    ]);
    assert.deepEqual(plain(reads().map(([, a, o]) => [a[3], a[4], a[5], o])), [["/work/cx", "t7", "codex", {}]]);
    assert.deepEqual(strings(find(await draw(), "context-sum")), ["~1.2k readable", "a new session's start · size not recorded"]);
    ok("Codex: my setup (skills, instructions) as for the others; Codex's own skills and session notes; no conversation, and the sum says the size is not recorded");

    await at("setup/skills/auto"); await press("l");
    assert.deepEqual(await under("Automatic"), ["tdd [loaded] ~600", "notes [codex only] ~50"]);
    await press("l");
    assert.ok((await told()).includes("description ~100 · body ~500 · the model loaded it") && (await told()).includes("~/.agents/skills/tdd/SKILL.md"), (await told()).join(" | "));
    await press("h", "h"); await at("agent/can/skills"); await press("l"); await at("agent/can/skills/auto"); await press("l");
    assert.deepEqual(await under("Automatic", "Configurable"), ["imagegen ~100"]);
    await press("h"); await at("agent/can/skills"); await press("h");
    ok("Codex's skills by the folder each is listed from: the shared ~/.agents/skills and ~/.codex/skills mine (the last marked), the rest Codex's own; one its thread read is loaded");

    await at("agent/unread"); await press("l");
    assert.deepEqual(await under("Not readable"), ["Conversation [not readable]", "System prompt [not readable]", "Tools [not readable]"]);
    await press("l");
    assert.ok((await told()).some((x) => /records no context size/.test(x)), (await told()).join(" | "));
    await press("h", "h"); await at("agent/fixed/session"); await press("l");
    assert.deepEqual(await under("Session notes"), ["around the skills ~100", "permissions ~100", "environments ~50"]);
    await press("h");
    ok("Codex: its system prompt, tools and the conversation are named as not readable; its notes unfold");
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
