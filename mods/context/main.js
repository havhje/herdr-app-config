// The context pane, in the sidebar in place of the agents list: what is in the focused agent's context and what each
// part costs. A line per part (the conversation, the system prompt, tools, MCP, instructions, agent types, session
// notes), each unfolding to its rows (all folded at first), then the skills: loaded ones (the whole SKILL.md is in the context), the ones
// only described to the model, and the ones the model does not see. Tokens are characters / 4, an estimate; the
// context's size is the real one from the last turn, and the conversation is what is left of it after the other parts.
// Claude Code only so far; for another agent it says so.
// Read on the agent's machine, in one exec. The agent's session: the live Claude Code process whose HC_TERMINAL_ID is
// the agent's terminal (~/.claude/sessions/<pid>.json), and from that session's transcript the request as it was sent
// (system prompt and tool definitions), the notes Claude Code attached (instructions, MCP servers' instructions, the
// listings of skills, agent types and deferred tools), the skill bodies loaded since the last compaction, and the last
// turn's usage. From disk, for a skill's file and description and the ones the model does not see: every SKILL.md's
// header under ~/.claude/skills and under .claude/skills from the session's folder (else the pane's) up to its repo's
// top, and the skillOverrides in the settings files there. With no session found (no /proc), the disk alone:
// descriptions estimated, loaded unknown, no other parts.
// The model sees a skill unless its header has disable-model-invocation: true, or an override says
// user-invocable-only or off (settings.local.json, then the repo's settings.json, then ~/.claude/settings.json);
// the session's own listing wins over that.
// Read when the pane is opened, when another agent is followed and when the followed agent stops working; r reads again.
// Keys as the explorer's: j/k, ctrl-d/ctrl-u half a page, gg/G, l (enter, right) unfolds a part, steps into an unfolded
// one or opens a row's file in nvim (its own terminal window, as the explorer does), h (left) folds a part or goes from a row to its part. r reloads, q back to the
// agents list, esc back to the terminals. <leader>ac shows it and puts it away.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { focused, panes, layout, exec, theme, settings, shared, nextCommand, run, notify } from "herdr";

const ROW = 24;
// Fixed heights, so the lines that fit can be counted from the pane's own height (told in zoomed pixels).
const HEAD = 36, SUM = 26, ABOUT = 140, FOOT = 26, PAD = 6;
// $1: the pane's folder. $2: the agent's terminal id. Prints NUL-separated records: T folder lines (the session's
// folder and its transcript's lines about what is in the context), U usage (the last turn's), P line (the request as
// last sent: system prompt and tools), S scope file header (a SKILL.md), O scope text (a settings file).
const READ = `
dir=$1
live=
for f in "$HOME"/.claude/sessions/*.json; do
  [ -f "$f" ] || continue
  pid=\${f##*/}; pid=\${pid%.json}
  [ -r "/proc/$pid/environ" ] || continue
  tr '\\0' '\\n' < "/proc/$pid/environ" 2>/dev/null | grep -qx "HC_TERMINAL_ID=$2" || continue
  grep -q '"kind": *"interactive"' "$f" || continue
  at=$(sed -n 's/.*"startedAt": *\\([0-9]*\\).*/\\1/p' "$f" | head -n 1)
  live="$live\${at:-0} $f
"
done
f=$(printf '%s' "$live" | sort -n | head -n 1 | cut -d' ' -f2-)
if [ -n "$f" ]; then
  sid=$(sed -n 's/.*"sessionId": *"\\([^"]*\\)".*/\\1/p' "$f" | head -n 1)
  cwd=$(sed -n 's/.*"cwd": *"\\([^"]*\\)".*/\\1/p' "$f" | head -n 1)
  [ -d "$cwd" ] && dir=$cwd
  t=$(ls "$HOME"/.claude/projects/*/"$sid".jsonl 2>/dev/null | head -n 1)
  printf 'T\\0%s\\0' "$dir"
  [ -n "$t" ] && grep -E '"type":"(skill_listing|invoked_skills|instructions|nested_memory|mcp_instructions_delta|deferred_tools_delta|agent_listing_delta|environment|session_context|model|date|auto_mode|tool_addition)"|"subtype":"compact_boundary"|Base directory for this skill: ' "$t"
  printf '\\0U\\0'
  [ -n "$t" ] && grep '"stop_reason"' "$t" | grep -v '"isSidechain":true' | grep -o '"usage":{[^{}]*' | tail -n 1
  printf '\\0P\\0'
  [ -n "$t" ] && grep '"type":"api-request-shape"' "$t" | tail -n 1
  printf '\\0'
fi
skills() {
  for f in "$2"/*/SKILL.md; do
    [ -f "$f" ] || continue
    printf 'S\\0%s\\0%s\\0' "$1" "$f"
    awk 'NR==1 && !/^---/ { exit } NR>1 && /^---/ { exit } NR>1 { print } NR>80 { exit }' "$f"
    printf '\\0'
  done
}
overrides() { [ -f "$2" ] && { printf 'O\\0%s\\0' "$1"; cat "$2"; printf '\\0'; }; }
skills user "$HOME/.claude/skills"
overrides user "$HOME/.claude/settings.json"
[ -d "$dir" ] || exit 0
top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || top=$dir
d=$dir
while :; do
  [ "$d" = "$HOME" ] || skills project "$d/.claude/skills"
  [ "$d" = "$top" ] && break
  d=\${d%/*}
  [ -n "$d" ] || break
done
[ "$top" = "$HOME" ] && exit 0
overrides project "$top/.claude/settings.json"
overrides local "$top/.claude/settings.local.json"
true`;

// Tokens, estimated as the pi resource explorer does: characters / 4.
export const tokens = (text) => Math.ceil((text ?? "").length / 4);
export const about = (n) => n < 1000 ? `~${n}` : `~${(n / 1000).toFixed(n < 99950 ? 1 : 0)}k`;
const sum = (list, of) => list.reduce((n, x) => n + of(x), 0);
const short = (path) => (path ?? "").replace(/^\/home\/[^/]+/, "~");

const unquote = (v) => /^(".*"|'.*')$/.test(v) ? v.slice(1, -1) : v;
// A SKILL.md header's top-level keys. A value on the lines under its key (folded, or a > or | block) is joined with spaces.
export function header(text) {
  const out = {};
  let key = null;
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (m) { key = m[1]; const v = m[2].trim(); out[key] = /^[>|][+-]?$/.test(v) ? "" : unquote(v); }
    else if (key && /^\s+\S/.test(line)) out[key] = (out[key] ? out[key] + " " : "") + line.trim();
  }
  return out;
}

// The skill listing the model was given, "- name: description" lines, as [{ name, text }]. A description may run
// over several lines, so with the names known only one of them starts an entry.
function listing(content, names) {
  const known = new Set(names), out = [];
  for (const line of content.split("\n")) {
    const m = /^- (\S+?)(?::\s|$)/.exec(line);
    if (m && (known.size ? known.has(m[1]) : true)) out.push({ name: m[1], text: line });
    else if (out.length) out[out.length - 1].text += "\n" + line;
  }
  return out;
}

const json = (line) => { try { return JSON.parse(line); } catch { return null; } };
// A note Claude Code attached, as the model was given it.
const rendered = (r) => Array.isArray(r.rendered) ? r.rendered.map((x) => typeof x?.content === "string" ? x.content : JSON.stringify(x?.content ?? "")).join("\n") : typeof r.rendered === "string" ? r.rendered : "";

// A session's transcript lines, as what is in its context now. notes: the attached notes still there, by type (a
// compaction drops them; the ones sent again after it replace them). listed: name → { tokens, description } from the
// skill listing. bodies: the skill bodies loaded ({ name or dir, tokens, how }), the ones before the last compaction
// left out. added: the tools loaded after the start, name → tokens.
function sessionIn(lines) {
  const rows = lines.split("\n").map((l) => l && json(l)).filter(Boolean);
  let cut = -1;
  rows.forEach((r, i) => { if (r.type === "system" && r.subtype === "compact_boundary") cut = i; });
  const notes = {}, bodies = [], added = new Map();
  let stale = [];
  rows.forEach((r, i) => {
    if (r.type === "system" && r.subtype === "compact_boundary") { stale = Object.keys(notes); return; }
    if (r.type === "api-request-blob") for (const c of r.message?.content ?? []) if (c?.type === "tool_addition") added.set(c.tool?.definition?.name ?? c.tool?.name ?? "a tool", tokens(JSON.stringify(c.tool)));
    const a = r.type === "attachment" ? r.attachment : null;
    if (a?.type === "invoked_skills") { if (i > cut) for (const s of a.skills ?? []) bodies.push({ name: s.name, tokens: tokens(s.content), how: "kept through compaction" }); }
    else if (a?.type) {
      if (stale.includes(a.type)) { notes[a.type] = []; stale = stale.filter((t) => t !== a.type); }
      (notes[a.type] = notes[a.type] ?? []).push(r);
    }
    if (i < cut || r.type !== "user") return;
    const blocks = typeof r.message?.content === "string" ? [{ type: "text", text: r.message.content }] : r.message?.content ?? [];
    for (const b of blocks) {
      const m = b?.type === "text" && /^Base directory for this skill: (.+)/.exec(b.text);
      if (m) bodies.push({ dir: m[1].trim(), tokens: tokens(b.text), how: r.sourceToolUseID ? "the model loaded it" : "you ran it" });
    }
  });
  const listed = new Map();
  for (const r of notes.skill_listing ?? []) for (const s of listing(r.attachment.content ?? "", r.attachment.names ?? [])) listed.set(s.name, { tokens: tokens(s.text), description: s.text.slice(s.name.length + 4).trim() });
  return { notes, listed, bodies, added, compacted: cut >= 0 };
}

// A skill's tokens in the context: its description and, loaded, its body.
export const cost = (s) => (s.listed ?? 0) + s.body;

// The skills: the disk's (found, with the settings' overrides), and what the session says of them.
function skillsIn(found, over, seen) {
  const told = seen?.listed.size ? seen.listed : null;
  const byName = new Map();
  for (const s of found) {
    const name = s.head.name || s.file.split("/").at(-2);
    // A personal skill wins over a repo's of the same name, as in Claude Code.
    if (byName.has(name)) continue;
    const state = over.local?.[name] ?? over.project?.[name] ?? over.user?.[name] ?? "on";
    const manual = /^true$/i.test(s.head["disable-model-invocation"] ?? "");
    const group = told?.has(name) ? "model" : state === "off" ? "off" : manual || state === "user-invocable-only" ? "you" : "model";
    const note = [s.scope === "project" ? "repo" : "", group !== "model" ? "" : state === "name-only" ? "name only" : /^false$/i.test(s.head["user-invocable"] ?? "") ? "model only" : ""].filter(Boolean).join(" · ");
    const description = s.head.description ?? "";
    const listed = group !== "model" ? null : told ? told.get(name)?.tokens ?? null : tokens(state === "name-only" ? `- ${name}` : `- ${name}: ${description}`);
    byName.set(name, { name, description, file: s.file, group, note, listed, body: 0, times: 0, how: "" });
  }
  // The ones only the listing knows: plugin and built-in skills.
  for (const [name, l] of told ?? []) if (!byName.has(name)) byName.set(name, { name, description: l.description, file: null, group: "model", note: name.includes(":") ? "plugin" : "", listed: l.tokens, body: 0, times: 0, how: "" });
  for (const b of seen?.bodies ?? []) {
    const base = b.dir?.split("/").filter(Boolean).at(-1);
    const name = b.name ?? [...byName.values()].find((s) => s.file === `${b.dir}/SKILL.md`)?.name
      ?? [...byName.keys()].find((n) => n === base || n.endsWith(`:${base}`)) ?? base;
    if (!byName.has(name)) byName.set(name, { name, description: "", file: b.dir ? `${b.dir}/SKILL.md` : null, group: "model", note: "", listed: null, body: 0, times: 0, how: "" });
    const s = byName.get(name);
    // A plugin's skill is not among the disk's: its file is known once it is loaded, from the folder the body names.
    if (!s.file && b.dir) s.file = `${b.dir}/SKILL.md`;
    s.body += b.tokens; s.times++; s.how = b.how; s.group = "loaded";
  }
  // A row's tokens, part by part.
  const detail = (s) => s.group === "loaded" ? [s.listed != null ? `description ${about(s.listed)}` : "", `body ${about(s.body)}${s.times > 1 ? ` (×${s.times})` : ""}`, s.how].filter(Boolean).join(" · ")
    : s.listed != null ? `description ${about(s.listed)} · not loaded` : s.group === "model" && told ? "not in the model's list" : s.group === "model" ? "" : "not in the context";
  return [...byName.values()].map((s) => ({ ...s, tokens: cost(s), detail: detail(s) })).sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
}

const byCost = (items) => items.sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
const row = (name, n, more) => ({ name, tokens: n, note: "", description: "", detail: "", file: null, ...more });
// The other parts of a session's context, each { key, label, about, items }: the request as sent (shape) and the notes attached.
function partsIn(seen, shape) {
  const notes = seen.notes, all = (type) => notes[type] ?? [];
  const tools = [...(shape?.tools ?? []).map((t) => [t.name ?? t.type ?? "a tool", tokens(JSON.stringify(t)), t.description ?? ""]), ...[...seen.added].map(([name, n]) => [name, n, "Loaded after the start (a deferred tool)."])];
  const deferred = all("deferred_tools_delta"), names = deferred.flatMap((r) => r.attachment.addedNames ?? []);
  const servers = new Map();
  for (const r of all("mcp_instructions_delta")) {
    (r.attachment.addedNames ?? []).forEach((name, i) => servers.set(name, r.attachment.addedBlocks?.[i] ?? ""));
    for (const name of r.attachment.removedNames ?? []) servers.delete(name);
  }
  const agents = new Map();
  for (const r of all("agent_listing_delta")) {
    (r.attachment.addedTypes ?? []).forEach((type, i) => agents.set(type, r.attachment.addedLines?.[i] ?? ""));
    for (const type of r.attachment.removedTypes ?? []) agents.delete(type);
  }
  const files = new Map();
  for (const f of [...all("instructions").flatMap((r) => r.attachment.files ?? []), ...all("nested_memory").map((r) => r.attachment.content)]) if (f?.path) files.set(f.path, f);
  const mcp = (name) => name.startsWith("mcp__");
  return [
    { key: "system", label: "System prompt", about: "Claude Code's own instructions to the model, sent with every request.",
      own: shape ? sum(shape.system ?? [], (b) => tokens(b.text)) : 0, items: [] },
    { key: "tools", label: "Tools", about: "The definitions of the tools the model can call, and the names of the ones it can load.",
      items: byCost([...tools.filter(([name]) => !mcp(name)).map(([name, n, description]) => row(name, n, { description })),
        ...(deferred.length ? [row("names of deferred tools", sum(deferred, (r) => tokens(rendered(r))), { note: String(names.length), description: names.join(", ") })] : [])]) },
    { key: "mcp", label: "MCP", about: "MCP servers: their instructions, and the definitions of their tools that are loaded.",
      items: byCost([...[...servers].map(([name, text]) => row(name, tokens(text), { note: "instructions", description: text.replace(/^## .*\n/, "") })),
        ...tools.filter(([name]) => mcp(name)).map(([name, n, description]) => row(name.slice(5).replace("__", " · "), n, { note: "tool", description }))]) },
    { key: "instructions", label: "Instructions", about: "CLAUDE.md and the other instruction files loaded for this session.",
      items: byCost([...files.values()].map((f) => row(short(f.path), tokens(f.content), { note: (f.type ?? "").toLowerCase(), description: f.content ?? "", file: f.path }))) },
    { key: "agents", label: "Agent types", about: "The agent types the model can start, as described to it.",
      items: byCost([...agents].map(([type, line]) => row(type, tokens(line), { description: line.replace(/^- [^:]+: /, "") }))) },
    { key: "session", label: "Session notes", about: "What Claude Code tells the model about this session: the folder, the model, git status, the date.",
      items: byCost(["environment", "session_context", "model", "date", "auto_mode"].filter((type) => all(type).length)
        .map((type) => row(type.replace(/_/g, " "), sum(all(type), (r) => tokens(rendered(r))), { note: all(type).length > 1 ? `×${all(type).length}` : "", description: rendered(all(type).at(-1)) }))) },
  ];
}

// What the read printed, as { groups, session }: the context's parts in the order drawn, each { key, label, about,
// tokens, items }, an item { name, tokens, note, description, detail, file } (a skill also group, listed, body, times, how).
// session: null when none was found, else { cwd, listing (the model's own skill list was read), context (the last
// turn's real size, or null), compacted }. With a context known, the first part is the conversation: what is left of it.
export function accountIn(stdout) {
  const parts = stdout.split("\0"), found = [], over = {};
  let seen = null, usage = "", shape = null;
  for (let i = 0; i < parts.length - 1;) {
    if (parts[i] === "S") { found.push({ scope: parts[i + 1], file: parts[i + 2], head: header(parts[i + 3] ?? "") }); i += 4; }
    else if (parts[i] === "O") { try { over[parts[i + 1]] = JSON.parse(parts[i + 2]).skillOverrides ?? {}; } catch { /* a broken settings file overrides nothing */ } i += 3; }
    else if (parts[i] === "T") { seen = { cwd: parts[i + 1], ...sessionIn(parts[i + 2] ?? "") }; i += 3; }
    else if (parts[i] === "U") { usage = parts[i + 1] ?? ""; i += 2; }
    else if (parts[i] === "P") { shape = json(parts[i + 1] ?? "")?.shape ?? null; i += 2; }
    else i++;
  }
  const skills = skillsIn(found, over, seen), told = Boolean(seen?.listed.size);
  const of = (group) => skills.filter((s) => s.group === group);
  const groups = [
    ...(seen ? partsIn(seen, shape) : []),
    { key: "loaded", label: "Skills loaded", about: "Skills whose whole SKILL.md is in the context: the model loaded them, or you ran them.", items: of("loaded") },
    // With no listing read, nothing says which are loaded: the group is just the ones the model sees.
    { key: "model", label: told ? "Skills, description only" : "Skills the model sees", about: "Skills the model is told of by name and description; a body comes in when one is loaded.", items: of("model") },
    { key: "you", label: "Skills only you run (/name)", about: "Skills kept from the model: not in the context until you run one.", items: of("you") },
    { key: "off", label: "Skills off", about: "Skills switched off in the settings.", items: of("off") },
  ].map((g) => ({ ...g, tokens: (g.own ?? 0) + sum(g.items, (x) => x.tokens) })).filter((g) => g.tokens || g.items.length);
  const n = (key) => Number(new RegExp(`"${key}":(\\d+)`).exec(usage)?.[1] ?? 0);
  const context = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
  if (context) groups.unshift({ key: "talk", label: "Conversation", about: "What was said, called and returned since the last compaction: the context's real size less the parts below.", tokens: Math.max(0, context - sum(groups, (g) => g.tokens)), items: [] });
  return { groups, session: seen ? { cwd: seen.cwd, listing: told, context: context || null, compacted: seen.compacted } : null };
}

const find = (n, id) => n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean) ?? null;
// Herdr keeps a hidden copy alive: read nothing unless this pane is the one the sidebar shows.
function shownNow() {
  const l = layout();
  return !find(l, "sidebar")?.hidden && find(l, "sidebar-body")?.active === "context";
}
// The machine an agent's address names ("vps/t7"); none for one here.
const machine = (address) => address?.includes("/") ? address.split("/")[0] : undefined;
const isClaude = (p) => p?.app === "claude-code" || p?.program?.key === "claude";

export default class Context extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.agent = null; this.cursor = null; this.g = 0; this.top = 0; this.height = 600; this.fit = 16; this.wheel = 0;
    this.lists = new Map(); this.loading = new Set(); this.failed = new Set(); this.shown = null; this.status = null;
    this.open = new Set();
    cx.spawn(async (cx) => { for (;;) { if (await nextCommand() === "focus") { this.handle.focus(); cx.notify(); } } });
    // <leader>ac asks for the keyboard and a fresh read through shared "context.open" (a time). One seen at start is old,
    // unless it is the very ask that showed this copy for the first time.
    const asked = shared("context.open");
    this.asked = asked && Date.now() - asked < 2000 ? null : asked;
  }

  // The agent to follow: the focused one, else the last one focused (the keyboard may be here).
  follow() {
    const a = focused()?.agent;
    if (a) this.agent = a;
    return panes().find((p) => p.terminal === this.agent) ?? null;
  }

  keyOf(p) { return p && isClaude(p) ? `${p.terminal}\n${p.cwd ?? ""}` : null; }

  load(p, cx) {
    const key = this.keyOf(p);
    if (!key || this.loading.has(key)) return;
    this.loading.add(key);
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", READ, "context", p.cwd ?? "", p.terminal.split("/").at(-1)], { on: machine(p.terminal) }).catch(() => null);
        if (r?.code === 0) { this.lists.set(key, accountIn(r.stdout)); this.failed.delete(key); }
        else this.failed.add(key);
      } finally { this.loading.delete(key); cx.notify(); }
    });
  }

  // The followed agent's context as the lines drawn: a line per part, then its rows when it is unfolded.
  // Each has an id, the cursor's name for it.
  lines(p) {
    return (this.lists.get(this.keyOf(p))?.groups ?? []).flatMap((group) => [{ id: `#${group.key}`, group },
      ...(this.open.has(group.key) ? group.items.map((item) => ({ id: `${group.key}/${item.name}`, group, item })) : [])]);
  }

  openFile(item, p) {
    if (!item.file) return notify({ title: `No file known for ${item.name}`, body: "Not a file on disk (a plugin's or a built-in part)", level: "info", timeout: 2500 });
    if (machine(p?.terminal)) return notify({ title: "That file is on another machine", body: item.file, level: "info", timeout: 2500 });
    // As the explorer: nvim in its own terminal window, outside Herdr, started in the agent's folder.
    exec("omarchy-launch-editor", [item.file], { cwd: this.lists.get(this.keyOf(p))?.session?.cwd || p?.cwd || undefined })
      .then((r) => { if (r.code !== 0) throw new Error(r.stderr.trim() || "omarchy-launch-editor failed"); })
      .catch((err) => notify({ title: `Could not open ${item.name}`, body: String(err.message ?? err), level: "error" }));
  }

  fold(group, cx) {
    if (!group.items.length) return;
    if (this.open.has(group.key)) this.open.delete(group.key); else this.open.add(group.key);
    this.cursor = `#${group.key}`;
    cx.notify();
  }

  // The lines drawn, and where the cursor is among them.
  at(p) {
    const list = this.lines(p);
    return { list, i: Math.max(0, list.findIndex((l) => l.id === this.cursor)) };
  }

  move(p, n, cx) {
    const { list } = this.at(p);
    if (!list.length) return;
    this.cursor = list[Math.max(0, Math.min(list.length - 1, n))].id;
    cx.notify();
  }

  key(e, cx) {
    const k = e.keystroke, p = this.follow(), { list, i } = this.at(p), line = list[i];
    const move = (n) => this.move(p, n, cx), page = Math.max(1, Math.floor(this.fit / 2));
    const g = this.g; this.g = 0;
    if (k === "j" || k === "down") move(i + 1);
    else if (k === "k" || k === "up") move(i - 1);
    else if (k === "ctrl-d") move(i + page);
    else if (k === "ctrl-u") move(i - page);
    else if (e.key_char === "G" || k === "shift-g") move(list.length - 1);
    else if (k === "g") { if (g && Date.now() - g < 600) move(0); else this.g = Date.now(); }
    // As the explorer's tree: l opens a row's file, unfolds a part, or steps into an unfolded one; h folds a part, or
    // goes from a row to its part.
    else if ((k === "l" || k === "enter" || k === "right") && line) {
      if (line.item) this.openFile(line.item, p);
      else if (!this.open.has(line.group.key)) this.fold(line.group, cx);
      else move(i + 1);
    } else if ((k === "h" || k === "left") && line) {
      if (line.item) move(list.findIndex((l) => l.id === `#${line.group.key}`));
      else if (this.open.has(line.group.key)) this.fold(line.group, cx);
    }
    else if (k === "r") this.load(p, cx);
    else if (k === "q") { run("layout.select", { stack: "sidebar-body", child: "agents" }); run("pane.go", { direction: "left" }); }
    else if (k === "escape") run("pane.go", { direction: "left" });
    else return;
    cx.stop_propagation();
  }

  render(cx) {
    const t = theme(), p = this.follow(), key = this.keyOf(p), here = shownNow();
    const asked = shared("context.open"), fresh = asked !== this.asked;
    if (fresh) { this.asked = asked; this.handle.focus(); }
    // Read again for another agent, and when the followed one stops working: a turn may have loaded a skill.
    const stopped = this.status === "working" && p?.status !== "working" && key === this.shown;
    if (here && key && (fresh || stopped || key !== this.shown || (!this.lists.has(key) && !this.failed.has(key)))) { this.shown = key; this.load(p, cx); }
    this.status = p?.status ?? null;
    const got = this.lists.get(key), session = got?.session ?? null, groups = got?.groups ?? [];
    const skills = sum(groups.filter((g) => ["loaded", "model", "you", "off"].includes(g.key)), (g) => g.tokens);
    const share = (n) => session?.context ? `${(100 * n / session.context).toFixed(1)}%` : "";
    const [size, side] = !got ? ["", ""] : session?.context ? [`${about(session.context).slice(1)} context`, `skills ${about(skills)} · ${share(skills)}${session.compacted ? " · compacted" : ""}`]
      : [`${about(skills)} tokens`, !session ? "no session found: loaded unknown" : "no turn yet: loaded unknown"];
    const focusedNow = this.handle.is_focused(), lines = this.lines(p);
    const sel = Math.max(0, lines.findIndex((l) => l.id === this.cursor)), cur = lines[sel] ?? null;
    // Only the lines that fit are drawn, moved to keep the cursor's in view (its part's line too, when it is the line above).
    const fit = Math.max(1, Math.floor((this.height - HEAD - (got ? SUM : 0) - (cur ? ABOUT : 0) - FOOT - 2 * PAD - 2) / ROW)), first = sel > 0 && !lines[sel - 1].item ? sel - 1 : sel;
    this.fit = fit;
    if (first < this.top) this.top = Math.max(0, first);
    if (sel >= this.top + fit) this.top = sel - fit + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, lines.length - fit)));
    const pick = (l) => (_ev, cx) => { this.cursor = l.id; this.handle.focus(); if (!l.item) this.fold(l.group, cx); cx.notify(); };
    const line = (l) => !l.item
      ? h_flex().id(`context-h-${l.group.key}`).h(ROW).flex_none().px(8).gap(6).items_center().rounded(6).cursor_pointer()
        .when(focusedNow && l === cur, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover)).on_click(pick(l))
        .child(div().flex_none().w(10).text_size(10).text_color(t.dim).child(!l.group.items.length ? "" : this.open.has(l.group.key) ? "▾" : "▸"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(l.group.label))
        .when(l.group.items.length > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(l.group.items.length))))
        .when(l.group.tokens > 0, (el) => el.child(div().flex_none().w(46).text_right().text_size(11).child(about(l.group.tokens))))
      : h_flex().id(`context-row-${l.id}`).h(ROW).flex_none().pl(24).pr(8).gap(8).items_center().rounded(6).cursor_pointer()
        .when(focusedNow && l === cur, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover)).on_click(pick(l))
        .child(div().flex_1().min_w(0).truncate().text_color(l.item.tokens ? t.foreground : t.muted).child(l.item.name))
        .when(Boolean(l.item.note), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(l.item.note)))
        .when(l.item.tokens > 0, (el) => el.child(div().flex_none().w(46).text_right().text_size(11).text_color(l.group.key === "loaded" ? t.foreground : t.dim).child(about(l.item.tokens))));
    // Under the list, the cursor's line: what it is, its tokens and its file.
    const told = !cur ? [] : cur.item
      ? [cur.item.description || "No description", [cur.item.detail || (cur.item.tokens ? `${about(cur.item.tokens)} tokens` : ""), cur.item.detail ? "" : share(cur.item.tokens)].filter(Boolean).join(" · "), cur.item.file ? short(cur.item.file) : ""]
      : [cur.group.about, [cur.group.tokens ? `${about(cur.group.tokens)} tokens` : "not in the context", cur.group.tokens ? share(cur.group.tokens) : "", cur.group.items.length ? `${cur.group.items.length} rows` : ""].filter(Boolean).join(" · "), ""];
    const empty = !p ? "No agent focused yet"
      : !key ? `Read for Claude Code only so far, not ${p.program?.name ?? p.app ?? "this agent"}`
      : this.failed.has(key) ? "Could not read the context (r tries again)"
      : !this.lists.has(key) ? "Reading…" : "Nothing found";
    return v_flex().id("context").size_full().on_size_change((size, cx) => { const h = size.height / (settings().zoom ?? 1); if (h !== this.height) { this.height = h; cx.notify(); } }).min_h(0).rounded(10).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .border_1().border_color(focusedNow ? t.accent : t.border).track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(HEAD).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Context"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(p?.terminal ?? "")))
      .when(Boolean(got), (el) => el.child(h_flex().id("context-sum").h(SUM).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(div().flex_none().child(size))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(t.dim).child(side))))
      .child(v_flex().id("context-list").flex_1().min_h(0).p(PAD).overflow_hidden().font_family(settings().font ?? "JetBrains Mono").text_size(12)
        // The wheel moves the cursor, a line per row's height: the lines drawn follow the cursor.
        .on_scroll_wheel((e, cx) => {
          this.wheel -= e.delta?.y ?? 0;
          const n = Math.trunc(this.wheel / ROW);
          if (n) { this.wheel -= n * ROW; this.move(p, this.at(p).i + n, cx); }
        })
        .children(lines.length ? lines.slice(this.top, this.top + fit).map(line) : [div().p(8).text_color(t.dim).child(empty)]))
      .when(Boolean(cur), (el) => el.child(v_flex().id("context-about").h(ABOUT).flex_none().overflow_hidden().px(12).py(8).gap(4).border_t(1).border_color(t.border).text_size(12)
        .child(div().flex_1().min_h(0).overflow_hidden().text_color(t.muted).child(told[0].slice(0, 600)))
        .when(Boolean(told[1]), (el) => el.child(div().flex_none().truncate().text_size(11).child(told[1])))
        .when(Boolean(told[2]), (el) => el.child(div().flex_none().overflow_hidden().whitespace_nowrap().text_ellipsis_start().text_size(11).text_color(t.dim).child(told[2])))))
      .child(h_flex().h(FOOT).flex_none().items_center().px(12).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child("j/k  h/l fold, open  r reload  q agents"));
  }
}
