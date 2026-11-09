// The context pane, in the sidebar in place of the agents list: what is in the focused agent's context and what each
// part costs, as a tree by whose it is, the dearest first at every level. The agent (everything that is its own or
// only works there, gone with another agent), split in Configurable (switched off or changed with its settings
// or flags: its tools, its own skills and MCP servers) and Fixed (sent whatever my settings say: the system
// prompt, for Claude Code its agent types and session notes too); my setup (what I added myself and could take to
// another agent: my skills, instruction files, the MCP servers, tools and agent types I set up). The conversation
// is not a part: it grows by itself and is not mine to trim, so it is only in the sum's real size. Skills are split
// by who starts them: automatic (the agent is given the description and may load the skill itself), manual (only I
// run it, by /name) and off; a loaded one (the whole SKILL.md is in the context) is marked. Tokens are characters / 4,
// an estimate; the context's size is the real one from the last turn.
// Every number is shown once. The sum, on top: the parts' tokens together and, dim, the real size with the
// conversation. A line: its tokens and its share of the part it is in (a top part's of the sum); an unfolded part
// shows none, the lines under it do, so what is drawn always adds up. Under the list, the cursor's line: only what
// its line does not say (what it is, an unfolded part's tokens, its rows, a skill's tokens by description and body,
// its file). A loaded skill has a dot and is bright.
// Whose a skill is: mine when its SKILL.md is in a skills folder of mine. The shared folder is ~/.agents/skills (every
// agent's skills are linked from there); one only in the agent's own folder (~/.claude/skills/<name>, a --skill
// folder of Pi's) is mine too, marked "claude only" / "pi only"; a repo's is marked "repo". The rest are the
// agent's: built in, a plugin's (name with a colon), or synced from the account (~/.claude/skills/synced).
// Claude Code, Pi and Codex so far (AGENTS); for another agent it says so. Each is read on the agent's machine, in one exec,
// and gives the same tree.
// Claude Code. The agent's session: the live Claude Code process whose HC_TERMINAL_ID is the agent's terminal
// (~/.claude/sessions/<pid>.json), and from that session's transcript the request as it was sent (system prompt and
// tool definitions), the notes Claude Code attached (instructions, MCP servers' instructions, the listings of skills,
// agent types and deferred tools), the skill bodies loaded since the last compaction, and the last turn's usage. From
// disk, for a skill's file and description and the ones the model does not see: every SKILL.md's header under
// ~/.claude/skills and under .claude/skills from the session's folder (else the pane's) up to its repo's top, and the
// skillOverrides in the settings files there. With no session found (no /proc), the disk alone: descriptions
// estimated, loaded unknown, no other parts.
// The model sees a skill unless its header has disable-model-invocation: true, or an override says
// user-invocable-only or off (settings.local.json, then the repo's settings.json, then ~/.claude/settings.json);
// the session's own listing wins over that.
// An MCP server is Claude Code's when it is a claude.ai connector or one of its built-in servers (CLAUDES), else
// mine. An agent type is Claude Code's when its listing says built in, or it is a plugin's.
// Pi. The agent's session: the oldest live pi process whose HC_TERMINAL_ID is the agent's terminal, and its session
// file (its --session, else the newest in its folder's sessions written since it started). From that file the system
// messages (the system prompt by section: Pi's own wording, the instruction files, the skills listed, the MCP
// servers named; and each tool's definition), the SKILL.md files read or run since the last compaction (their size
// from disk), and the last turn's usage. From disk, the headers of the skills Pi was started with (--skill, and its
// own skills folder unless --no-skills). Pi's built-in tools (PI_TOOLS) are its own; the other tools are my
// extensions'. Every skill and MCP server there is one I set up.
// Codex. It keeps no record of what a session sent (its database holds the conversation alone), so its system
// prompt, its tools and the context's size are named as not readable. Read instead: what codex debug prompt-input
// prints for the session's folder (the oldest live codex process of the terminal; else the pane's folder), which is
// how a new session there starts: the skills listed with their folders (~/.agents/skills: mine; ~/.codex/skills:
// mine, "codex only"; the rest Codex's own), the instruction files, and its session notes. And, with sqlite3 there,
// the SKILL.md files the session's thread read since its last compaction (the newest thread of that folder written
// since the process started).
// What can be changed is from each agent's own documentation (Claude Code's settings and CLI reference, pi --help).
// Read when the pane is opened, when another agent is followed and when the followed agent stops working; r reads again.
// Keys as the explorer's: j/k, ctrl-d/ctrl-u half a page, gg/G, l (enter, right) unfolds a part, steps into an unfolded
// one or opens a row's file in nvim (its own terminal window, as the explorer does), h (left) folds a part or goes from a row to its part. r reloads, q back to the
// agents list, esc back to the terminals. <leader>ac shows it and puts it away.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { focused, panes, layout, exec, theme, settings, shared, nextCommand, run, notify } from "herdr";

const ROW = 24;
// Fixed heights, so the lines that fit can be counted from the pane's own height (told in zoomed pixels).
const HEAD = 36, SUM = 26, ABOUT = 140, FOOT = 26, PAD = 6, INDENT = 14;
// $1: the pane's folder. $2: the agent's terminal id. $3: the agent (claude, pi). Prints NUL-separated records.
// S scope file header: a SKILL.md (scope: shared when ~/.agents/skills has that skill, else user; project: a repo's).
// Claude Code: T folder lines (the session's folder and its transcript's lines about what is in the context),
// U usage (the last turn's), P line (the request as last sent: system prompt and tools), O scope text (a settings file).
// Pi: I folder lines (the session's folder, its system messages and a compaction's mark), U usage, B how file bytes
// (a SKILL.md read by the model or run by me since the last compaction).
// Codex: X folder json (the folder, and what codex debug prompt-input prints there), A names (the skills in
// ~/.agents/skills, a line each), B as Pi's.
const READ = `
dir=$1
one() {
  [ -f "$2" ] || return 0
  n=\${2%/SKILL.md}; n=\${n##*/}; s=$1
  [ "$s" = user ] && [ -f "$HOME/.agents/skills/$n/SKILL.md" ] && s=shared
  printf 'S\\0%s\\0%s\\0' "$s" "$2"
  awk 'NR==1 && !/^---/ { exit } NR>1 && /^---/ { exit } NR>1 { print } NR>80 { exit }' "$2"
  printf '\\0'
}
skills() { for f in "$2"/*/SKILL.md; do one "$1" "$f"; done; }
overrides() { [ -f "$2" ] && { printf 'O\\0%s\\0' "$1"; cat "$2"; printf '\\0'; }; }
oldest() {
  for e in /proc/[0-9]*/environ; do
    q=\${e#/proc/}; q=\${q%/environ}
    [ -r "$e" ] && [ "$(cat "/proc/$q/comm" 2>/dev/null)" = "$1" ] || continue
    tr '\\0' '\\n' < "$e" 2>/dev/null | grep -qx "HC_TERMINAL_ID=$2" || continue
    echo "$(awk '{ print $22 }' "/proc/$q/stat" 2>/dev/null) $q"
  done | sort -n | head -n 1 | cut -d' ' -f2
}
cut=0
body() {
  [ "$2" -gt "$cut" ] || return 0
  b=$3; case "$b" in "~/"*) b="$HOME/\${b#??}";; /*) ;; *) b="$dir/$b";; esac
  [ -f "$b" ] && printf 'B\\0%s\\0%s\\0%s\\0' "$1" "$b" "$(wc -c < "$b")"
}
if [ "$3" = codex ]; then
  pid=$(oldest codex "$2")
  bin=codex; home=$HOME/.codex
  if [ -n "$pid" ]; then
    cwd=$(readlink "/proc/$pid/cwd"); [ -d "$cwd" ] && dir=$cwd
    [ -x "/proc/$pid/exe" ] && bin=/proc/$pid/exe
    h=$(tr '\\0' '\\n' < "/proc/$pid/environ" | sed -n 's/^CODEX_HOME=//p' | head -n 1); home=\${h:-$home}
  fi
  [ -d "$dir" ] || exit 0
  printf 'X\\0%s\\0' "$dir"
  (cd "$dir" && timeout 20 "$bin" debug prompt-input 2>/dev/null)
  printf '\\0A\\0'
  ls "$HOME/.agents/skills" 2>/dev/null
  printf '\\0'
  state=$(ls -t "$home"/state_*.sqlite 2>/dev/null | head -n 1); history=$(ls -t "$home"/thread_history_*.sqlite 2>/dev/null | head -n 1)
  if [ -n "$pid" ] && [ -n "$state" ] && [ -n "$history" ] && command -v sqlite3 >/dev/null 2>&1; then
    q=$(printf '%s' "$dir" | sed "s/'/''/g")
    tid=$(sqlite3 -readonly "$state" "select id from threads where cwd='$q' and updated_at >= $(stat -c %Y "/proc/$pid") order by updated_at desc limit 1" 2>/dev/null)
    [ -n "$tid" ] && sqlite3 -readonly "$history" "select item_json from thread_items where thread_id='$tid' and item_type='commandExecution' and item_json like '%SKILL.md%' and rollout_ordinal > (select coalesce(max(rollout_ordinal),-1) from thread_items where thread_id='$tid' and item_type='contextCompaction')" 2>/dev/null | grep -o '"name":"SKILL.md","path":"[^"]*"' | while IFS= read -r l; do
      body model 1 "$(printf '%s' "$l" | sed 's/.*"path":"//; s/"$//')"
    done
  fi
  exit 0
fi
if [ "$3" = pi ]; then
  pid=$(oldest pi "$2")
  [ -n "$pid" ] || exit 0
  adir=$(tr '\\0' '\\n' < "/proc/$pid/environ" | sed -n 's/^PI_CODING_AGENT_DIR=//p' | head -n 1)
  adir=\${adir:-$HOME/.pi/agent}
  cwd=$(readlink "/proc/$pid/cwd"); [ -d "$cwd" ] && dir=$cwd
  args=$(tr '\\0' '\\n' < "/proc/$pid/cmdline")
  t=$(printf '%s\\n' "$args" | sed -n '/^--session$/{n;p;}' | head -n 1)
  if [ ! -f "$t" ]; then
    t=$(ls -t "$adir/sessions/--$(printf '%s' "\${dir#/}" | tr / -)--"/*.jsonl 2>/dev/null | head -n 1)
    [ -n "$t" ] && [ "$(stat -c %Y "$t")" -ge "$(stat -c %Y "/proc/$pid")" ] || t=
  fi
  printf 'I\\0%s\\0' "$dir"
  if [ -n "$t" ]; then
    grep '"message":{"role":"system"' "$t"
    cut=$(grep -n '^{"type":"compaction"' "$t" | tail -n 1 | cut -d: -f1); cut=\${cut:-0}
    [ "$cut" -gt 0 ] && printf '{"type":"compaction"}\\n'
  fi
  printf '\\0U\\0'
  [ -n "$t" ] && grep '"message":{"role":"assistant"' "$t" | grep -o '"usage":{[^{}]*' | tail -n 1
  printf '\\0'
  if [ -n "$t" ]; then
    grep -n -o '"name":"read","arguments":{"path":"[^"]*SKILL[.]md"' "$t" | while IFS= read -r l; do
      body model "\${l%%:*}" "$(printf '%s' "$l" | sed 's/.*"path":"//; s/"$//')"
    done
    grep -n -o '"text":"<skill name=."[^"]*" location=."[^"]*' "$t" | while IFS= read -r l; do
      body you "\${l%%:*}" "$(printf '%s' "$l" | sed 's/.*location=..//; s/.$//')"
    done
  fi
  printf '%s\\n' "$args" | sed -n '/^--skill$/{n;p;}' | while IFS= read -r a; do
    if [ -f "$a/SKILL.md" ]; then one user "$a/SKILL.md"; else skills user "$a"; fi
  done
  printf '%s\\n' "$args" | grep -qx -e --no-skills || skills user "$adir/skills"
  exit 0
fi
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

// The agents read, by this mod's name for each, and what each is called.
const AGENTS = { claude: "Claude Code", pi: "Pi", codex: "Codex" };
const KEYS = { "claude-code": "claude", claude: "claude", pi: "pi", codex: "codex" };
const agentOf = (p) => KEYS[p?.app] ?? KEYS[p?.program?.key] ?? null;

// Tokens, estimated as the pi resource explorer does: characters / 4.
export const tokens = (text) => Math.ceil((text ?? "").length / 4);
export const about = (n) => n < 1000 ? `~${n}` : `~${(n / 1000).toFixed(n < 99950 ? 1 : 0)}k`;
const sum = (list, of) => list.reduce((n, x) => n + of(x), 0);
// A line's share of what holds it: whole percent.
const percent = (n, of) => { const x = 100 * n / of; return x < 0.5 ? "<1%" : `${Math.round(x)}%`; };
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
// skill listing. bodies: the skill bodies loaded ({ name and source, or dir; tokens, how }), the ones before the last
// compaction left out. added: the tools loaded after the start, name → tokens.
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
    if (a?.type === "invoked_skills") { if (i > cut) for (const s of a.skills ?? []) bodies.push({ name: s.name, source: s.path ?? "", tokens: tokens(s.content), how: "kept through compaction" }); }
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

// A skills folder of mine holds the skill's own folder directly; the ones synced from the Claude account are deeper.
const inMine = (dir) => /\/\.(claude|agents|codex|pi\/agent)\/skills\/[^/]+$/.test(dir ?? "");
// The skills: the disk's (found, with the settings' overrides: mine), and what the session says of them.
function skillsIn(found, over, seen, agent) {
  const told = seen?.listed.size ? seen.listed : null;
  const byName = new Map();
  for (const s of found) {
    const name = s.head.name || s.file.split("/").at(-2);
    // A personal skill wins over a repo's of the same name, as in Claude Code.
    if (byName.has(name)) continue;
    const state = over.local?.[name] ?? over.project?.[name] ?? over.user?.[name] ?? "on";
    const manual = /^true$/i.test(s.head["disable-model-invocation"] ?? "");
    // Automatic: the model is given the description and may load the skill itself. Manual: only I run it, by /name.
    const kind = told?.has(name) ? "auto" : state === "off" ? "off" : manual || state === "user-invocable-only" ? "manual" : "auto";
    const note = [s.scope === "project" ? "repo" : s.scope === "user" ? `${agent} only` : "", kind !== "auto" ? "" : state === "name-only" ? "name only" : /^false$/i.test(s.head["user-invocable"] ?? "") ? "model only" : ""].filter(Boolean).join(" · ");
    const description = s.head.description ?? "";
    const listed = kind !== "auto" ? null : told ? told.get(name)?.tokens ?? null : tokens(state === "name-only" ? `- ${name}` : `- ${name}: ${description}`);
    byName.set(name, { name, description, file: s.file, mine: true, kind, note, listed, body: 0, times: 0, how: "", loaded: false });
  }
  // The ones only the listing knows: the agent's own, built in or a plugin's (one listed with its file is mine,
  // unless the listing says whose).
  for (const [name, l] of told ?? []) if (!byName.has(name)) byName.set(name, { name, description: l.description, file: l.file ?? null, mine: l.mine ?? Boolean(l.file), kind: "auto", note: l.note ?? (name.includes(":") ? "plugin" : ""), listed: l.tokens, body: 0, times: 0, how: "", loaded: false });
  for (const b of seen?.bodies ?? []) {
    const base = b.dir?.split("/").filter(Boolean).at(-1);
    const name = b.name ?? [...byName.values()].find((s) => s.file === `${b.dir}/SKILL.md`)?.name
      ?? [...byName.keys()].find((n) => n === base || n.endsWith(`:${base}`)) ?? base;
    // One neither on disk nor listed: manual when I ran it, else the model's. Mine by where its body came from.
    if (!byName.has(name)) byName.set(name, { name, description: "", file: b.dir ? `${b.dir}/SKILL.md` : null, mine: !name.includes(":") && (b.dir ? inMine(b.dir) : /^(user|project|local)Settings:/.test(b.source ?? "")), kind: b.how === "you ran it" ? "manual" : "auto", note: "", listed: null, body: 0, times: 0, how: "", loaded: false });
    const s = byName.get(name);
    // A plugin's skill is not among the disk's: its file is known once it is loaded, from the folder the body names.
    if (!s.file && b.dir) s.file = `${b.dir}/SKILL.md`;
    s.body += b.tokens; s.times++; s.how = b.how; s.loaded = true;
  }
  // A row's tokens, part by part.
  const detail = (s) => s.loaded ? [s.listed != null ? `description ${about(s.listed)}` : "", `body ${about(s.body)}${s.times > 1 ? ` (×${s.times})` : ""}`, s.how].filter(Boolean).join(" · ")
    : s.listed != null ? `description ${about(s.listed)} · not loaded` : s.kind === "auto" && told ? "not in the model's list" : s.kind === "auto" ? "" : "not in the context";
  return [...byName.values()].map((s) => ({ ...s, kids: [], tokens: cost(s), detail: detail(s) }));
}

const byCost = (items) => items.sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
// The tree's nodes. A row: one thing in the context. A part: a line that holds rows or other parts (kids, dearest
// first), its tokens their sum (and its own, for a part with no rows); count is the rows under it.
const row = (name, n, more) => ({ name, tokens: n, note: "", description: "", detail: "", file: null, kids: [], ...more });
const part = (key, name, description, kids, own = 0) => ({ key, name, description, note: "", detail: "", file: null, part: true,
  kids: byCost(kids), tokens: own + sum(kids, (x) => x.tokens), count: sum(kids, (x) => x.part ? x.count : 1) });
// Parts with nothing in them are left out.
const full = (parts) => parts.filter((x) => x.tokens || x.kids.length);
// An MCP server's name as its tools carry it: mcp__<name>__<tool>.
const mcp = (name) => name.startsWith("mcp__"), serverOf = (name) => name.slice(5).split("__")[0];
// Claude Code's own MCP servers, by that name: the claude.ai connectors (claude_ai_<name>) and the built-in ones.
const CLAUDES = new Set(["claude-in-chrome", "computer-use", "Claude_Browser", "remote-devices", "ide"]);
const claudes = (key) => key.startsWith("claude_ai_") || CLAUDES.has(key);
// The other parts of a session's context, by key: the request as sent (shape) and the notes attached.
function partsIn(seen, shape) {
  const notes = seen.notes, all = (type) => notes[type] ?? [];
  const tools = [...(shape?.tools ?? []).map((t) => [t.name ?? t.type ?? "a tool", tokens(JSON.stringify(t)), t.description ?? ""]), ...[...seen.added].map(([name, n]) => [name, n, "Loaded after the start (a deferred tool)."])];
  const deferred = all("deferred_tools_delta"), names = deferred.flatMap((r) => r.attachment.addedNames ?? []);
  // An agent type is mine when the listing names its built-in ones and this is not among them (nor a plugin's).
  const agents = new Map(), builtIn = new Set();
  let named = false;
  for (const r of all("agent_listing_delta")) {
    (r.attachment.addedTypes ?? []).forEach((type, i) => agents.set(type, r.attachment.addedLines?.[i] ?? ""));
    for (const type of r.attachment.removedTypes ?? []) agents.delete(type);
    if (Array.isArray(r.attachment.builtInTypes)) named = true;
    for (const type of [...r.attachment.builtInTypes ?? [], ...r.attachment.builtInPluginTypes ?? []]) builtIn.add(type);
  }
  const myType = (type) => named && !builtIn.has(type) && !type.includes(":");
  const types = (mine) => [...agents].filter(([type]) => myType(type) === mine).map(([type, line]) => row(type, tokens(line), { description: line.replace(/^- [^:]+: /, "") }));
  const files = new Map();
  for (const f of [...all("instructions").flatMap((r) => r.attachment.files ?? []), ...all("nested_memory").map((r) => r.attachment.content)]) if (f?.path) files.set(f.path, f);
  // MCP by server: its instructions, its tools' definitions that are loaded, and its share of the deferred tools' names.
  const told = new Map();
  for (const r of all("mcp_instructions_delta")) {
    (r.attachment.addedNames ?? []).forEach((name, i) => told.set(name, r.attachment.addedBlocks?.[i] ?? ""));
    for (const name of r.attachment.removedNames ?? []) told.delete(name);
  }
  const servers = new Map(), server = (key, name) => { if (!servers.has(key)) servers.set(key, { name: name ?? key, kids: [] }); return servers.get(key); };
  for (const [name, text] of told) server(name.replace(/[^A-Za-z0-9_-]/g, "_"), name).kids.push(row("instructions", tokens(text), { description: text.replace(/^## .*\n/, "") }));
  for (const [name, n, description] of tools.filter(([name]) => mcp(name))) server(serverOf(name)).kids.push(row(name.slice(5 + serverOf(name).length + 2) || name, n, { note: "tool", description }));
  const waiting = new Map();
  for (const name of names.filter(mcp)) waiting.set(serverOf(name), [...(waiting.get(serverOf(name)) ?? []), name]);
  for (const [key, list] of waiting) server(key).kids.push(row("names of deferred tools", tokens(list.join("\n") + "\n"), { note: String(list.length), description: list.map((name) => name.slice(5 + key.length + 2)).join(", ") }));
  const theirs = sum([...waiting.values()], (list) => tokens(list.join("\n") + "\n")), own = names.filter((name) => !mcp(name));
  return {
    system: part("system", "System prompt", "Claude Code's own instructions to the model, sent with every request. Replaced only as a whole (--system-prompt).", [], shape ? sum(shape.system ?? [], (b) => tokens(b.text)) : 0),
    tools: part("tools", "Tools", "The definitions of Claude Code's own tools, and the names of the ones the model can load. A tool's bare name in permissions.deny (or --disallowedTools) takes it out of the context.",
      [...tools.filter(([name]) => !mcp(name)).map(([name, n, description]) => row(name, n, { description })),
        ...(deferred.length ? [row("names of deferred tools", Math.max(0, sum(deferred, (r) => tokens(rendered(r))) - theirs), { note: String(own.length), description: own.join(", ") })] : [])]),
    mcp: part("mcp", "MCP", "The MCP servers I set up: for each, its instructions, the definitions of its tools that are loaded, and the names of the ones the model can load.",
      [...servers].filter(([key]) => !claudes(key)).map(([key, s]) => part(key, s.name, `The MCP server ${s.name}.`, s.kids))),
    mcpOwn: part("mcp", "MCP", "The MCP servers that come with Claude Code and my Claude account: claude.ai connectors (off with disableClaudeAiConnectors, or one by one in /mcp) and Claude in Chrome (/chrome). For each, its instructions, the definitions of its tools that are loaded, and the names of the ones the model can load.",
      [...servers].filter(([key]) => claudes(key)).map(([key, s]) => part(key, s.name, `The MCP server ${s.name}.`, s.kids))),
    instructions: part("instructions", "Instructions", "CLAUDE.md and the other instruction files loaded for this session.",
      [...files.values()].map((f) => row(short(f.path), tokens(f.content), { note: (f.type ?? "").toLowerCase(), description: f.content ?? "", file: f.path }))),
    agents: part("agents", "Agent types", "Claude Code's built-in agent types the model can start, as described to it. Only Explore and Plan can be dropped (CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1).", types(false)),
    agentsMine: part("agents", "Agent types", "The agent types I added that the model can start, as described to it.", types(true)),
    session: part("session", "Session notes", "What Claude Code tells the model about this session: the folder, the model, git status, the date.",
      ["environment", "session_context", "model", "date", "auto_mode"].filter((type) => all(type).length)
        .map((type) => row(type.replace(/_/g, " "), sum(all(type), (r) => tokens(rendered(r))), { note: all(type).length > 1 ? `×${all(type).length}` : "", description: rendered(all(type).at(-1)) }))),
  };
}

// A Pi session's lines (its system messages and a compaction's mark) and the SKILL.md files loaded since, as what
// is in its context now. sections: the system prompt by section (a later message's replace the same-named). tools:
// name → definition. listed and bodies as a Claude Code session's; a listed skill has its file.
function piIn(lines, loads) {
  const sections = {}, tools = new Map();
  let compacted = false;
  for (const r of lines.split("\n").map((l) => l && json(l)).filter(Boolean)) {
    if (r.type === "compaction") compacted = true;
    if (r.message?.role !== "system") continue;
    Object.assign(sections, r.message.sections ?? {});
    for (const t of r.message.toolsAdded ?? []) tools.set(t.name, t);
  }
  const listed = new Map();
  for (const m of (sections.skills ?? "").matchAll(/<skill>\s*<name>([^<]*)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<location>([^<]*)<\/location>\s*<\/skill>/g))
    listed.set(m[1].trim(), { tokens: tokens(m[0]), description: m[2].trim(), file: m[3].trim() });
  const bodies = loads.map((b) => ({ dir: b.file.replace(/\/SKILL\.md$/, ""), tokens: Math.ceil(b.bytes / 4), how: b.how === "you" ? "you ran it" : "the model loaded it" }));
  return { sections, tools, listed, bodies, compacted };
}

// Pi's built-in tools; any other tool is an extension's or a package's.
const PI_TOOLS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
// The other parts of a Pi session's context, by key, from its system prompt's sections and its tools' definitions.
function piParts(seen) {
  const text = (key) => seen.sections[key] ?? "";
  const files = [...text("project_context").matchAll(/<project_instructions path="([^"]*)">\n?([\s\S]*?)<\/project_instructions>/g)]
    .map((m) => row(short(m[1]), tokens(m[2]), { description: m[2], file: m[1] }));
  const servers = text("mcp_servers").split("\n").filter((l) => l.startsWith("- "))
    .map((l) => row(l.slice(2).split(/[ :]/)[0].replace(/^mcp__/, ""), tokens(l), { note: /\(([^)]*)\)/.exec(l)?.[1] ?? "", description: l.replace(/^[^:]*:\s*/, "") }));
  // What Pi writes around the skills, the instruction files and the servers.
  const around = Math.max(0, tokens(text("skills")) - sum([...seen.listed.values()], (l) => l.tokens)) + Math.max(0, tokens(text("project_context")) - sum(files, (f) => f.tokens))
    + Math.max(0, tokens(text("mcp_servers")) - sum(servers, (x) => x.tokens));
  const tools = (own) => [...seen.tools.values()].filter((t) => PI_TOOLS.has(t.name) === own).map((t) => row(t.name, tokens(JSON.stringify(t)), { description: t.description ?? "" }));
  const said = [["preamble", "Who the model is."], ["rules", "Pi's rules for its tools."], ["docs", "Where Pi's own documentation is."], ["tools", "The list of tools, a line each."], ["cwd", "The folder."]];
  return {
    system: part("system", "System prompt", "Pi's own instructions to the model, sent with every request. Replaced only as a whole (--system-prompt).",
      [...said.map(([key, description]) => row(key === "tools" ? "tool list" : key, tokens(text(key)), { description })), row("around my setup", around, { description: "What Pi writes around the skills, the instruction files and the MCP servers it lists." })].filter((x) => x.tokens)),
    tools: part("tools", "Tools", "The definitions of Pi's built-in tools. Chosen with --tools, --exclude-tools or --no-builtin-tools.", tools(true)),
    added: part("tools", "Extension tools", "The definitions of the tools my Pi extensions and packages add.", tools(false)),
    instructions: part("instructions", "Instructions", "AGENTS.md and the other instruction files loaded for this session.", files),
    mcp: part("mcp", "MCP", "The MCP servers I set up, as they are named to the model.", servers),
  };
}

// What Codex prints as a new session's start in a folder (the messages before the first prompt, each piece with its
// kind) and the SKILL.md files read since, as what is in the context. listed: the skills, each with its file (from
// the roots named) and whose it is: mine in a skills folder of mine (marked when the shared one, whose skills'
// names are in shared, has no such skill), else Codex's.
// instructions: the instruction files' text. notes: the other pieces. around: what is written around the skills.
function codexIn(text, loads, shared) {
  const listed = new Map(), notes = [], said = json(text);
  let instructions = "", around = 0;
  for (const m of Array.isArray(said) ? said : []) (m?.content ?? []).forEach((c, i) => {
    const kind = m.internal_chat_message_metadata_passthrough?.content_item_kinds?.[i] ?? "", t = c?.text ?? "";
    if (kind.startsWith("host_skills")) {
      const roots = new Map([...t.matchAll(/^- `(\w+)` = `([^`]*)`$/gm)].map((r) => [r[1], r[2]]));
      for (const s of t.matchAll(/^- (\S+?): (.*) \(file: ([^)]*)\)$/gm)) {
        const file = s[3].replace(/^\w+(?=\/)/, (root) => roots.get(root) ?? root), mine = inMine(file.replace(/\/SKILL\.md$/, ""));
        listed.set(s[1], { tokens: tokens(s[0]), description: s[2], file, mine, note: mine && !/\/\.agents\/skills\//.test(file) && !shared.has(s[1]) ? "codex only" : "" });
      }
      around += Math.max(0, tokens(t) - sum([...listed.values()], (l) => l.tokens));
    } else if (kind.startsWith("agents_md")) instructions += t;
    else if (t) notes.push({ kind, text: t });
  });
  const bodies = loads.map((b) => ({ dir: b.file.replace(/\/SKILL\.md$/, ""), tokens: Math.ceil(b.bytes / 4), how: "the model loaded it" }));
  return { listed, bodies, notes, instructions, around, compacted: false };
}

// The other parts of a Codex session's context, by key. Codex keeps no record of its system prompt, its tools'
// definitions or the context's size: those are named, as not readable.
function codexParts(seen) {
  const unread = (name, description) => row(name, 0, { note: "not readable", description });
  return {
    session: part("session", "Session notes", "What Codex tells the model about this session: its permissions, the folder, the plugins on offer, how skills work.",
      [...seen.notes.map((x) => row(x.kind.split(".")[0].replace(/_/g, " ") || "note", tokens(x.text), { description: x.text })),
        row("around the skills", seen.around, { description: "What Codex writes around the skills it lists: how skills work, and the folders they are in." })].filter((x) => x.tokens)),
    unread: part("unread", "Not readable", "Codex keeps no record of these, so what they cost is unknown. They are in the context all the same.", [
      unread("System prompt", "Codex's own instructions to the model. Not recorded."), unread("Tools", "The definitions of Codex's tools. Not recorded."),
      unread("Conversation", "What was said, called and returned. Codex records no context size.")]),
    instructions: part("instructions", "Instructions", "AGENTS.md and the other instruction files Codex loads in this folder.",
      seen.instructions ? [row("AGENTS.md", tokens(seen.instructions), { description: seen.instructions })] : []),
  };
}

// What the read printed for that agent, as { tree, session }. tree: the context as parts by whose they are, dearest
// first at every level: the agent (what I can change: its tools, own skills and MCP servers; what is fixed: the
// system prompt, for Claude Code agent types and session notes), my setup (my skills, instruction files, my MCP
// servers, tools and agent types). Skills are split
// into automatic, manual and off; MCP is by server. A node: { name, tokens, note, description, detail, file, kids },
// a part also { key, part, count }, a skill also { mine, kind, loaded, listed, body, times, how }.
// session: null when none was found, else { cwd, listing (the model's own skill list was read), context (the last
// turn's real size, or null), compacted, preview (Codex: a new session's start, not this session's record) }.
export function accountIn(stdout, agent = "claude") {
  const parts = stdout.split("\0"), found = [], over = {}, loads = [];
  let seen = null, usage = "", shape = null, shared = new Set();
  for (let i = 0; i < parts.length - 1;) {
    if (parts[i] === "S") { found.push({ scope: parts[i + 1], file: parts[i + 2], head: header(parts[i + 3] ?? "") }); i += 4; }
    else if (parts[i] === "O") { try { over[parts[i + 1]] = JSON.parse(parts[i + 2]).skillOverrides ?? {}; } catch { /* a broken settings file overrides nothing */ } i += 3; }
    else if (parts[i] === "T") { seen = { cwd: parts[i + 1], ...sessionIn(parts[i + 2] ?? "") }; i += 3; }
    else if (parts[i] === "I") { seen = { cwd: parts[i + 1], lines: parts[i + 2] ?? "" }; i += 3; }
    else if (parts[i] === "X") { seen = { cwd: parts[i + 1], text: parts[i + 2] ?? "" }; i += 3; }
    else if (parts[i] === "A") { shared = new Set((parts[i + 1] ?? "").split("\n").filter(Boolean)); i += 2; }
    else if (parts[i] === "B") { loads.push({ how: parts[i + 1], file: parts[i + 2], bytes: Number(parts[i + 3]) || 0 }); i += 4; }
    else if (parts[i] === "U") { usage = parts[i + 1] ?? ""; i += 2; }
    else if (parts[i] === "P") { shape = json(parts[i + 1] ?? "")?.shape ?? null; i += 2; }
    else i++;
  }
  const pi = agent === "pi", codex = agent === "codex", name = AGENTS[agent] ?? AGENTS.claude;
  if (seen && pi) seen = { cwd: seen.cwd, ...piIn(seen.lines ?? "", loads) };
  if (seen && codex) seen = { cwd: seen.cwd, ...codexIn(seen.text ?? "", loads, shared) };
  const all = skillsIn(found, over, seen, agent), p = !seen ? null : pi ? piParts(seen) : codex ? codexParts(seen) : partsIn(seen, shape);
  const skills = (mine, description) => { const of = (kind) => all.filter((s) => s.mine === mine && s.kind === kind); return part("skills", "Skills", description, full([
    part("auto", "Automatic", "Skills the agent may load by itself: it is given each one's description, in the context always; the body comes in when one is loaded.", of("auto")),
    part("manual", "Manual (/name)", "Skills only I run, by /name. Not in the context until I run one.", of("manual")),
    part("off", "Off", "Skills switched off in the settings.", of("off")),
  ])); };
  const theirs = skills(false, pi ? "Pi's own skills." : codex ? "Codex's own skills: built in, or from its plugins." : "Claude Code's own skills: built in (off with disableBundledSkills), from its plugins (/plugin), or synced from my Claude account (syncClaudeAiSkills).");
  const [can, fixed, setup] = !p ? [[theirs], [], []] : pi ? [[p.tools, theirs], [p.system], [p.instructions, p.mcp, p.added]]
    : codex ? [[theirs], [p.session], [p.instructions]]
    : [[p.tools, theirs, p.mcpOwn], [p.system, p.agents, p.session], [p.instructions, p.mcp, p.agentsMine]];
  const tree = byCost(full([
    part("agent", name, `Everything that is ${name}'s own or only works there. Gone with another agent.`, full([
      part("can", "Configurable", `What I can switch off or change with ${name}'s settings or flags.`, full(can)),
      part("fixed", "Fixed", `What ${name} sends whatever my settings say.`, full(fixed)),
      ...(p?.unread ? [p.unread] : []),
    ])),
    part("setup", "Your setup", "What I added myself and could take to another agent: my skills, instruction files, and the MCP servers, tools and agent types I set up. Mine to trim.",
      full([skills(true, `My skills. The shared ones are in ~/.agents/skills; one marked "${agent} only" is in this agent's own folder alone, one marked "repo" is the repo's.`), ...setup])),
  ]));
  const n = (...keys) => sum(keys, (key) => Number(new RegExp(`"${key}":(\\d+)`).exec(usage)?.[1] ?? 0));
  const context = pi ? n("input", "cacheRead", "cacheWrite") : n("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens");
  return { tree, session: seen ? { cwd: seen.cwd, listing: Boolean(seen?.listed.size), context: context || null, compacted: seen.compacted, preview: codex } : null };
}

const find = (n, id) => n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean) ?? null;
// Herdr keeps a hidden copy alive: read nothing unless this pane is the one the sidebar shows.
function shownNow() {
  const l = layout();
  return !find(l, "sidebar")?.hidden && find(l, "sidebar-body")?.active === "context";
}
// The machine an agent's address names ("vps/t7"); none for one here.
const machine = (address) => address?.includes("/") ? address.split("/")[0] : undefined;

export default class Context extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.agent = null; this.cursor = null; this.g = 0; this.top = 0; this.height = 600; this.fit = 16; this.wheel = 0;
    this.lists = new Map(); this.loading = new Set(); this.failed = new Set(); this.shown = null; this.status = null;
    // Unfolded at first: the agent's two halves, my setup and my skills, so the overview shows each part and my skills' kinds.
    this.open = new Set(["agent", "agent/can", "agent/fixed", "setup", "setup/skills"]);
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

  keyOf(p) { const agent = agentOf(p); return agent ? `${agent}\n${p.terminal}\n${p.cwd ?? ""}` : null; }

  load(p, cx) {
    const key = this.keyOf(p);
    if (!key || this.loading.has(key)) return;
    this.loading.add(key);
    cx.spawn(async (cx) => {
      try {
        const agent = agentOf(p);
        const r = await exec("sh", ["-c", READ, "context", p.cwd ?? "", p.terminal.split("/").at(-1), agent], { on: machine(p.terminal) }).catch(() => null);
        if (r?.code === 0) { this.lists.set(key, accountIn(r.stdout, agent)); this.failed.delete(key); }
        else this.failed.add(key);
      } finally { this.loading.delete(key); cx.notify(); }
    });
  }

  // The followed agent's context as the lines drawn: the tree's nodes, a part's kids under it when it is unfolded.
  // Each { id (the cursor's name for it: the keys down to it), node, depth, parent (its part's id), of (the tokens its
  // share is of: its part's, a top part's the sum's) }.
  lines(p) {
    const tree = this.lists.get(this.keyOf(p))?.tree ?? [];
    const out = [], walk = (nodes, depth, parent, of) => {
      for (const node of nodes) {
        const id = `${parent ? parent + "/" : ""}${node.key ?? node.name}`;
        out.push({ id, node, depth, parent, of });
        if (node.kids.length && this.open.has(id)) walk(node.kids, depth + 1, id, node.tokens);
      }
    };
    walk(tree, 0, null, sum(tree, (g) => g.tokens));
    return out;
  }

  openFile(item, p) {
    if (!item.file) return notify({ title: `No file known for ${item.name}`, body: "Not a file on disk (a plugin's or a built-in part)", level: "info", timeout: 2500 });
    if (machine(p?.terminal)) return notify({ title: "That file is on another machine", body: item.file, level: "info", timeout: 2500 });
    // As the explorer: nvim in its own terminal window, outside Herdr, started in the agent's folder.
    exec("omarchy-launch-editor", [item.file], { cwd: this.lists.get(this.keyOf(p))?.session?.cwd || p?.cwd || undefined })
      .then((r) => { if (r.code !== 0) throw new Error(r.stderr.trim() || "omarchy-launch-editor failed"); })
      .catch((err) => notify({ title: `Could not open ${item.name}`, body: String(err.message ?? err), level: "error" }));
  }

  fold(line, cx) {
    if (!line.node.kids.length) return;
    if (this.open.has(line.id)) this.open.delete(line.id); else this.open.add(line.id);
    this.cursor = line.id;
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
    // goes to the part a line is in.
    else if ((k === "l" || k === "enter" || k === "right") && line) {
      if (!line.node.part) this.openFile(line.node, p);
      else if (!line.node.kids.length) { /* a part with no rows: nothing to unfold */ }
      else if (!this.open.has(line.id)) this.fold(line, cx);
      else move(i + 1);
    } else if ((k === "h" || k === "left") && line) {
      if (line.node.kids.length && this.open.has(line.id)) this.fold(line, cx);
      else if (line.parent) move(list.findIndex((l) => l.id === line.parent));
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
    const got = this.lists.get(key), session = got?.session ?? null, tree = got?.tree ?? [];
    const rest = sum(tree, (g) => g.tokens);
    const [size, side] = !got ? ["", ""] : session?.preview ? [`${about(rest)} readable`, "a new session's start · size not recorded"] : session?.context ? [`${about(rest)} tokens`, `${about(session.context).slice(1)} with conversation${session.compacted ? " · compacted" : ""}`]
      : [`${about(rest)} tokens`, !session ? "no session found: loaded unknown" : "no turn yet: loaded unknown"];
    const focusedNow = this.handle.is_focused(), lines = this.lines(p);
    const sel = Math.max(0, lines.findIndex((l) => l.id === this.cursor)), cur = lines[sel] ?? null;
    // Only the lines that fit are drawn, moved to keep the cursor's in view (its part's line too, when it is the line above).
    const fit = Math.max(1, Math.floor((this.height - HEAD - (got ? SUM : 0) - (cur ? ABOUT : 0) - FOOT - 2 * PAD - 2) / ROW)), first = sel > 0 && lines[sel - 1].id === cur.parent ? sel - 1 : sel;
    this.fit = fit;
    if (first < this.top) this.top = Math.max(0, first);
    if (sel >= this.top + fit) this.top = sel - fit + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, lines.length - fit)));
    const pick = (l) => (_ev, cx) => { this.cursor = l.id; this.handle.focus(); if (l.node.part) this.fold(l, cx); cx.notify(); };
    // A part's line: an arrow, its name and, folded (or with nothing to unfold), its tokens and its share of the part
    // it is in (a top part's of the sum). Unfolded, the lines under it carry the numbers instead, so what is shown
    // always adds up: one level's shares to its part's, every number drawn to the sum on top. A row's: a dot when it
    // is loaded, its name, a note, its tokens and share. Each level a step further in, and the name and tokens
    // follow: a top part's bold, the next level's plain, deeper ones dim; a loaded row bright at any depth.
    const unfolded = (l) => l.node.kids.length > 0 && this.open.has(l.id);
    const cost = (l, bright) => (el) => el.child(div().flex_none().w(46).text_right().text_size(11).text_color(l.depth > 1 && !bright ? t.dim : t.foreground).when(l.depth === 0, (el) => el.font_semibold()).child(about(l.node.tokens)))
      .child(div().flex_none().w(28).text_right().text_size(11).text_color(t.dim).child(percent(l.node.tokens, l.of)));
    const line = (l) => { const n = l.node; return n.part
      ? h_flex().id(`context-h-${l.id}`).h(ROW).flex_none().pl(8 + l.depth * INDENT).pr(8).gap(6).items_center().rounded(6).cursor_pointer()
        .when(focusedNow && l === cur, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover)).on_click(pick(l))
        .child(div().flex_none().w(10).text_size(10).text_color(t.dim).child(!n.kids.length ? "" : this.open.has(l.id) ? "▾" : "▸"))
        .child(div().flex_1().min_w(0).truncate().when(l.depth === 0, (el) => el.font_semibold()).text_color(l.depth > 1 ? t.muted : t.foreground).child(n.name))
        .when(n.tokens > 0 && !unfolded(l), cost(l, false))
      : h_flex().id(`context-row-${l.id}`).h(ROW).flex_none().pl(8 + l.depth * INDENT).pr(8).gap(8).items_center().rounded(6).cursor_pointer()
        .when(focusedNow && l === cur, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover)).on_click(pick(l))
        .child(div().flex_none().w(10).text_size(10).text_color(t.accent).child(n.loaded ? "●" : ""))
        .child(div().flex_1().min_w(0).truncate().text_color(n.loaded ? t.foreground : n.tokens ? t.muted : t.dim).child(n.name))
        .when(Boolean(n.note), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(n.note)))
        .when(n.tokens > 0, cost(l, Boolean(n.loaded))); };
    // Under the list, the cursor's line, what its line does not say: what it is, an unfolded part's tokens, a part's
    // rows, a skill's tokens by description and body, its file.
    const at = cur?.node, told = !at ? [] : !at.part
      ? [at.description || "No description", at.detail, at.file ? short(at.file) : ""]
      : [at.description, [!at.tokens ? "not in the context" : unfolded(cur) ? `${about(at.tokens)} tokens` : "", at.count ? `${at.count} rows` : ""].filter(Boolean).join(" · "), ""];
    const empty = !p ? "No agent focused yet"
      : !key ? `Read for ${Object.values(AGENTS).join(", ")} only so far, not ${p.program?.name ?? p.app ?? "this agent"}`
      : this.failed.has(key) ? "Could not read the context (r tries again)"
      : !this.lists.has(key) ? "Reading…" : "Nothing found";
    return v_flex().id("context").size_full().on_size_change((size, cx) => { const h = size.height / (settings().zoom ?? 1); if (h !== this.height) { this.height = h; cx.notify(); } }).min_h(0).rounded(10).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .border_1().border_color(focusedNow ? t.accent : t.border).track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(HEAD).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Context"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(p?.terminal ?? "")))
      .when(Boolean(got), (el) => el.child(h_flex().id("context-sum").h(SUM).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(div().flex_none().font_semibold().child(size))
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
