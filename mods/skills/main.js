// The skills pane, in the sidebar in place of the agents list: the skills the focused agent has, and whether the model
// sees each one. Claude Code only so far; for another agent it says so. Read from disk on the agent's machine, in one
// exec: every SKILL.md's header under ~/.claude/skills and under .claude/skills from the agent's folder up to its
// repo's top, and the skillOverrides in the settings files there. Plugin and built-in skills are not read.
// The model sees a skill unless its header has disable-model-invocation: true, or an override says
// user-invocable-only or off (settings.local.json, then the repo's settings.json, then ~/.claude/settings.json).
// Read when the pane is opened and when the followed agent's folder changes; r reads again.
// Keys as nvim: j/k, gg/G, enter/l opens the SKILL.md in nvim, r reloads, q back to the agents list,
// esc/h back to the terminals. <leader>as shows it and puts it away.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { focused, panes, layout, exec, theme, settings, shared, nextCommand, run, notify } from "herdr";

const ROW = 24;
// Fixed heights, so the lines that fit can be counted from the pane's own height (told in zoomed pixels).
const HEAD = 36, ABOUT = 124, FOOT = 26, PAD = 6;
const GROUPS = [["model", "Model sees"], ["you", "Only you (/name)"], ["off", "Off"]];
// $1: the agent's folder. Prints NUL-separated records: S scope file header (a SKILL.md), O scope text (a settings file).
const READ = `
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
[ -d "$1" ] || exit 0
top=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) || top=$1
d=$1
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

// What the read printed, as skills by name: { name, description, file, scope, group: model | you | off, note }.
export function skillsIn(stdout) {
  const parts = stdout.split("\0"), found = [], over = {};
  for (let i = 0; i < parts.length - 1;) {
    if (parts[i] === "S") { found.push({ scope: parts[i + 1], file: parts[i + 2], head: header(parts[i + 3] ?? "") }); i += 4; }
    else if (parts[i] === "O") { try { over[parts[i + 1]] = JSON.parse(parts[i + 2]).skillOverrides ?? {}; } catch { /* a broken settings file overrides nothing */ } i += 3; }
    else i++;
  }
  const byName = new Map();
  for (const s of found) {
    const name = s.head.name || s.file.split("/").at(-2);
    // A personal skill wins over a repo's of the same name, as in Claude Code.
    if (byName.has(name)) continue;
    const state = over.local?.[name] ?? over.project?.[name] ?? over.user?.[name] ?? "on";
    const manual = /^true$/i.test(s.head["disable-model-invocation"] ?? "");
    const group = state === "off" ? "off" : manual || state === "user-invocable-only" ? "you" : "model";
    const note = [s.scope === "project" ? "repo" : "", group !== "model" ? "" : state === "name-only" ? "name only" : /^false$/i.test(s.head["user-invocable"] ?? "") ? "model only" : ""].filter(Boolean).join(" · ");
    byName.set(name, { name, description: s.head.description ?? "", file: s.file, scope: s.scope, group, note });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const find = (n, id) => n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean) ?? null;
// Herdr keeps a hidden copy alive: read nothing unless this pane is the one the sidebar shows.
function shownNow() {
  const l = layout();
  return !find(l, "sidebar")?.hidden && find(l, "sidebar-body")?.active === "skills";
}
// The machine an agent's address names ("vps/t7"); none for one here.
const machine = (address) => address?.includes("/") ? address.split("/")[0] : undefined;
const isClaude = (p) => p?.app === "claude-code" || p?.program?.key === "claude";

export default class Skills extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.agent = null; this.cursor = null; this.g = 0; this.top = 0; this.height = 600; this.wheel = 0;
    this.lists = new Map(); this.loading = new Set(); this.failed = new Set();
    cx.spawn(async (cx) => { for (;;) { if (await nextCommand() === "focus") { this.handle.focus(); cx.notify(); } } });
    // <leader>as asks for the keyboard and a fresh read through shared "skills.open" (a time). One seen at start is old,
    // unless it is the very ask that showed this copy for the first time.
    const asked = shared("skills.open");
    this.asked = asked && Date.now() - asked < 2000 ? null : asked;
  }

  // The agent to follow: the focused one, else the last one focused (the keyboard may be here).
  follow() {
    const a = focused()?.agent;
    if (a) this.agent = a;
    return panes().find((p) => p.terminal === this.agent) ?? null;
  }

  keyOf(p) { return p && isClaude(p) ? `${machine(p.terminal) ?? ""}\n${p.cwd ?? ""}` : null; }

  load(p, cx) {
    const key = this.keyOf(p);
    if (!key || this.loading.has(key)) return;
    this.loading.add(key);
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", READ, "skills", p.cwd ?? ""], { on: machine(p.terminal) }).catch(() => null);
        if (r?.code === 0) { this.lists.set(key, skillsIn(r.stdout)); this.failed.delete(key); }
        else this.failed.add(key);
      } finally { this.loading.delete(key); cx.notify(); }
    });
  }

  // The followed agent's skills as the lines drawn: a heading per group that has any, then its skills.
  lines(p) {
    const list = this.lists.get(this.keyOf(p)) ?? [];
    return GROUPS.flatMap(([group, label]) => {
      const mine = list.filter((s) => s.group === group);
      return mine.length ? [{ head: label, n: mine.length }, ...mine.map((skill) => ({ skill }))] : [];
    });
  }

  open(s, p) {
    if (machine(p?.terminal)) return notify({ title: "That skill is on another machine", body: s.file, level: "info", timeout: 2500 });
    exec("omarchy-launch-editor", [s.file])
      .then((r) => { if (r.code !== 0) throw new Error(r.stderr.trim() || "omarchy-launch-editor failed"); })
      .catch((err) => notify({ title: `Could not open ${s.name}`, body: String(err.message ?? err), level: "error" }));
  }

  // The followed agent's skills in the order drawn, and where the cursor is among them.
  at(p) {
    const list = this.lines(p).filter((l) => l.skill).map((l) => l.skill);
    return { list, i: Math.max(0, list.findIndex((s) => s.name === this.cursor)) };
  }

  move(p, n, cx) {
    const { list } = this.at(p);
    if (!list.length) return;
    this.cursor = list[Math.max(0, Math.min(list.length - 1, n))].name;
    cx.notify();
  }

  key(e, cx) {
    const k = e.keystroke, p = this.follow(), { list, i } = this.at(p), row = list[i];
    const move = (n) => this.move(p, n, cx);
    const g = this.g; this.g = 0;
    if (k === "j" || k === "down") move(i + 1);
    else if (k === "k" || k === "up") move(i - 1);
    else if (e.key_char === "G" || k === "shift-g") move(list.length - 1);
    else if (k === "g") { if (g && Date.now() - g < 600) move(0); else this.g = Date.now(); }
    else if ((k === "enter" || k === "l") && row) this.open(row, p);
    else if (k === "r") this.load(p, cx);
    else if (k === "q") { run("layout.select", { stack: "sidebar-body", child: "agents" }); run("pane.go", { direction: "left" }); }
    else if (k === "escape" || k === "h" || k === "left") run("pane.go", { direction: "left" });
    else return;
    cx.stop_propagation();
  }

  render(cx) {
    const t = theme(), p = this.follow(), key = this.keyOf(p), here = shownNow();
    const asked = shared("skills.open"), fresh = asked !== this.asked;
    if (fresh) { this.asked = asked; this.handle.focus(); }
    if (here && key && (fresh || (!this.lists.has(key) && !this.failed.has(key)))) this.load(p, cx);
    const focusedNow = this.handle.is_focused(), lines = this.lines(p), skills = lines.filter((l) => l.skill);
    const at = Math.max(0, lines.findIndex((l) => l.skill?.name === this.cursor)), sel = lines[at]?.skill ? at : lines.findIndex((l) => l.skill);
    const cur = lines[sel]?.skill ?? null;
    // Only the lines that fit are drawn, moved to keep the cursor's in view (its group's heading too, when it is the line above).
    const fit = Math.max(1, Math.floor((this.height - HEAD - (cur ? ABOUT : 0) - FOOT - 2 * PAD - 2) / ROW)), first = sel > 0 && lines[sel - 1].head ? sel - 1 : sel;
    if (first < this.top) this.top = Math.max(0, first);
    if (sel >= this.top + fit) this.top = sel - fit + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, lines.length - fit)));
    const row = (l) => l.head
      ? h_flex().id(`skills-h-${l.head}`).h(ROW).flex_none().px(8).gap(6).items_end().pb(3).text_size(11).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(l.head)).child(div().flex_none().child(String(l.n)))
      : h_flex().id(`skill-${l.skill.name}`).h(ROW).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .when(focusedNow && l.skill === cur, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
        .on_click((_ev, cx) => { this.cursor = l.skill.name; this.handle.focus(); cx.notify(); })
        .child(div().flex_1().min_w(0).truncate().text_color(l.skill.group === "model" ? t.foreground : t.muted).child(l.skill.name))
        .when(Boolean(l.skill.note), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(l.skill.note)));
    const empty = !p ? "No agent focused yet"
      : !key ? `Skills are read for Claude Code only so far, not ${p.program?.name ?? p.app ?? "this agent"}`
      : this.failed.has(key) ? "Could not read the skills (r tries again)"
      : !this.lists.has(key) ? "Reading…" : "No skills";
    return v_flex().id("skills").size_full().on_size_change((size, cx) => { const h = size.height / (settings().zoom ?? 1); if (h !== this.height) { this.height = h; cx.notify(); } }).min_h(0).rounded(10).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .border_1().border_color(focusedNow ? t.accent : t.border).track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(HEAD).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Skills"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(p ? `${p.terminal}${skills.length ? ` · ${skills.length}` : ""}` : "")))
      .child(v_flex().id("skills-list").flex_1().min_h(0).p(PAD).overflow_hidden().font_family(settings().font ?? "JetBrains Mono").text_size(12)
        // The wheel moves the cursor, a line per row's height: the lines drawn follow the cursor.
        .on_scroll_wheel((e, cx) => {
          this.wheel -= e.delta?.y ?? 0;
          const n = Math.trunc(this.wheel / ROW);
          if (n) { this.wheel -= n * ROW; this.move(p, this.at(p).i + n, cx); }
        })
        .children(lines.length ? lines.slice(this.top, this.top + fit).map(row) : [div().p(8).text_color(t.dim).child(empty)]))
      .when(Boolean(cur), (el) => el.child(v_flex().id("skills-about").h(ABOUT).flex_none().overflow_hidden().px(12).py(8).gap(4).border_t(1).border_color(t.border).text_size(12)
        .child(div().flex_1().min_h(0).overflow_hidden().text_color(t.muted).child(cur.description || "No description"))
        .child(div().flex_none().overflow_hidden().whitespace_nowrap().text_ellipsis_start().text_size(11).text_color(t.dim).child(cur.file.replace(/^\/home\/[^/]+/, "~")))))
      .child(h_flex().h(FOOT).flex_none().items_center().px(12).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child("j/k  ⏎ open  r reload  q agents"));
  }
}
