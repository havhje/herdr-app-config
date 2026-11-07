// A lazy file browser for the focused pane's folder, with bounded read-only previews.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, v_virtual_list, VirtualListScrollHandle, Scrollbar, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, nextCommand, run, notify } from "herdr";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    // nvim (snacks explorer) keys: a cursor row, kept by path so refreshes don't move it.
    this.scroll = VirtualListScrollHandle.new(); this.cursor = null; this.g = 0; this.height = 400;
    // The command line at the bottom: / filter, a add, r rename, d delete (y/n). ask = { kind, row }.
    this.filter = ""; this.ask = null; this.note = null;
    this.input = InputState.new({ placeholder: "" });
    this.input.on("change", (_e, cx) => { if (this.ask?.kind === "filter") { this.filter = this.input.value(); cx.notify(); } });
    this.input.on("submit", (_e, cx) => this.answer(cx));
    // nvim-style window moves: pane.go hands this copy the keyboard (mod.json focusable).
    cx.spawn(async (cx) => { for (;;) { if (await nextCommand() === "focus") { this.handle.focus(); cx.notify(); } } });
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  // The tree as shown, top to bottom: every entry of the root and of each open folder.
  visible(prefix = "", depth = 0, out = []) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push({ path, entry, depth });
      if (entry.dir && this.folders.has(path)) this.visible(path, depth + 1, out);
    }
    return out;
  }

  // The rows to show: with a filter, every file and folder under the root (closed folders too)
  // whose name matches (or path, when the filter has a "/"), with the folders above them.
  shown() {
    const f = this.filter.trim().toLowerCase();
    if (!f) return this.visible();
    if (!this.index) return [];
    if (this.cache?.f === f && this.cache.index === this.index) return this.cache.rows;
    const keep = new Set(), byPath = f.includes("/");
    for (const [path] of this.index) if ((byPath ? path : path.slice(path.lastIndexOf("/") + 1)).toLowerCase().includes(f)) {
      keep.add(path);
      for (let p = path; p.includes("/");) { p = p.slice(0, p.lastIndexOf("/")); keep.add(p); }
    }
    // Rebuild the kept paths as a tree: folders first, then by name, as in the open tree.
    const kids = new Map();
    for (const path of keep) {
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push({ name: path.slice(path.lastIndexOf("/") + 1), dir: this.index.get(path) });
    }
    const rows = [], walk = (prefix, depth) => {
      for (const entry of (kids.get(prefix) ?? []).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))) {
        if (rows.length >= TOTAL) return;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        rows.push({ path, entry, depth, found: true });
        if (entry.dir) walk(path, depth + 1);
      }
    };
    walk("", 0);
    this.cache = { f, index: this.index, rows };
    return rows;
  }

  // Every file under the root, for the filter: fd (honors .gitignore), else git, else find.
  // Folders come from the files' paths (empty folders aren't found). Loaded when the filter opens.
  loadIndex(cx) {
    const context = this.context;
    if (!this.root || this.indexing || this.indexKey === context.key) return;
    this.indexing = true;
    const script = 'if command -v fd >/dev/null 2>&1; then fd -0 --hidden --exclude .git -t f -t l --max-results 50000 .; ' +
      'elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git ls-files -z -co --exclude-standard | head -z -n 50000; ' +
      'else find . -name .git -prune -o \\( -type f -o -type l \\) -print0 | head -z -n 50000; fi';
    cx.spawn(async cx => {
      try {
        const r = await exec("sh", ["-c", script], { cwd: this.root, on: this.on });
        if (!this.current(context)) return;
        const index = new Map();
        for (let path of r.stdout.split("\0")) {
          path = path.replace(/^\.\//, "");
          if (!path) continue;
          index.set(path, false);
          for (let p = path; p.includes("/");) { p = p.slice(0, p.lastIndexOf("/")); if (index.get(p) === true) break; index.set(p, true); }
        }
        this.index = index; this.indexKey = context.key;
      } catch (e) { if (this.current(context)) this.say(`Filter: ${e.message ?? e}`); }
      finally { this.indexing = false; cx.notify(); }
    });
  }

  // Opens a file in nvim in its own terminal window (Omarchy's default editor), outside Herdr.
  edit(path, cx) {
    if (this.on) { this.say("nvim outside Herdr works for this computer's files only"); cx.notify(); return; }
    const full = `${this.root}/${path}`;
    cx.spawn(async () => { try { await exec("omarchy-launch-editor", [full], { cwd: this.root }); } catch (e) { notify({ title: "Could not open nvim", body: String(e), level: "error" }); } });
  }

  say(text) { this.note = text; }

  // The folder a new file goes in: the row's folder, or the folder holding the row.
  base(row) {
    if (!row) return "";
    if (row.entry.dir) return row.path;
    return row.path.includes("/") ? row.path.slice(0, row.path.lastIndexOf("/")) : "";
  }

  prompt(kind, row, value, cx) {
    this.ask = { kind, row }; this.note = null;
    this.input.set_value(value ?? "");
    this.input.focus();
    cx.notify();
  }

  done(cx) {
    this.ask = null; this.input.set_value("");
    this.handle.focus();
    cx.notify();
  }

  // Enter in the command line.
  answer(cx) {
    const a = this.ask, text = this.input.value().trim(), root = this.root, on = this.on;
    if (!a) return;
    if (a.kind === "filter") { this.ask = null; this.handle.focus(); cx.notify(); return; }
    this.done(cx);
    if (!text) return;
    const sh = async (args, after) => {
      try {
        const r = await exec(args[0], args.slice(1), { cwd: root, on });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `${args[0]} failed`);
        after?.(); this.say(null);
      } catch (e) { this.say(String(e.message ?? e)); }
      this.refresh(cx);
    };
    cx.spawn(async () => {
      if (a.kind === "add") {
        const base = this.base(a.row), rel = base ? `${base}/${text}` : text, dir = text.endsWith("/");
        if (base && a.row?.entry.dir && !this.folders.has(base)) this.toggle(base, cx);
        const clean = rel.replace(/\/+$/, "");
        await sh(dir ? ["mkdir", "-p", "--", clean] : ["sh", "-c", 'mkdir -p -- "$(dirname -- "$1")" && touch -- "$1"', "add", clean], () => { this.cursor = clean; });
      } else if (a.kind === "rename") {
        const parent = a.row.path.includes("/") ? a.row.path.slice(0, a.row.path.lastIndexOf("/")) : "", to = parent ? `${parent}/${text}` : text;
        await sh(["mv", "-n", "--", a.row.path, to], () => { this.cursor = to; });
      } else if (a.kind === "delete") {
        if (!/^y(es)?$/i.test(text)) return;
        await sh(["gio", "trash", "--", a.row.path]);
      }
    });
  }

  // Where the cursor is now; a path that's gone (folder closed, file deleted) falls back to the first row.
  at(list) {
    const i = list.findIndex((r) => r.path === this.cursor);
    return i < 0 ? 0 : i;
  }

  move(list, i, cx) {
    if (!list.length) return;
    i = Math.max(0, Math.min(list.length - 1, i));
    this.cursor = list[i].path;
    this.scroll.scroll_to_item(i);
    cx.notify();
  }

  key(e, cx) {
    const k = e.keystroke, c = e.key_char;
    // Typing in the command line: only Esc is ours (cancel; for a filter, clear it).
    if (this.ask) {
      if (e.key === "escape") { if (this.ask.kind === "filter") this.filter = ""; this.done(cx); cx.stop_propagation(); }
      return;
    }
    // Preview open: q, h, esc or backspace go back to the tree.
    if (this.file) {
      if (["q", "h", "escape", "backspace"].includes(e.key) && !e.keystroke.includes("ctrl")) { this.show(null); cx.stop_propagation(); cx.notify(); }
      return;
    }
    const list = this.shown(), i = this.at(list), row = list[i], page = Math.max(1, Math.floor(this.height / 28 / 2));
    const g = this.g; this.g = 0;
    if (k === "j" || k === "down") this.move(list, i + 1, cx);
    else if (k === "k" || k === "up") this.move(list, i - 1, cx);
    else if (k === "ctrl-d") this.move(list, i + page, cx);
    else if (k === "ctrl-u") this.move(list, i - page, cx);
    else if (c === "G" || k === "shift-g") this.move(list, list.length - 1, cx);
    else if (k === "g") { if (g && Date.now() - g < 600) this.move(list, 0, cx); else this.g = Date.now(); }
    else if ((k === "l" || k === "enter" || k === "right") && row) {
      if (!row.entry.dir) this.edit(row.path, cx);
      else if (!this.folders.has(row.path)) this.toggle(row.path, cx);
      else this.move(list, i + 1, cx);
    } else if ((k === "h" || k === "left") && row) {
      if (row.entry.dir && this.folders.has(row.path)) this.toggle(row.path, cx);
      else {
        const parent = row.path.includes("/") ? row.path.slice(0, row.path.lastIndexOf("/")) : null;
        if (parent) this.move(list, list.findIndex((r) => r.path === parent), cx);
      }
    } else if (k === "p" && row && !row.entry.dir) this.show(row.path, cx);
    else if (k === "/") { this.indexKey = null; this.loadIndex(cx); this.prompt("filter", row, this.filter, cx); }
    else if (k === "a") this.prompt("add", row, "", cx);
    else if (k === "r" && row) this.prompt("rename", row, row.entry.name, cx);
    else if (k === "d" && row) this.prompt("delete", row, "", cx);
    else if (k === "escape" && this.filter) { this.filter = ""; cx.notify(); }
    else if (k === "escape") run("pane.go", { direction: "right" });
    // q closes the explorer, as in nvim.
    else if (k === "q") { run("pane.go", { direction: "right" }); run("layout.hide", { id: "panel" }); }
    else return;
    cx.stop_propagation();
  }

  // nvim's command line: the question and its input, else the filter in use, else the last error.
  cmdline(t) {
    const a = this.ask, font = settings().font ?? "JetBrains Mono";
    const label = !a ? null : a.kind === "filter" ? "/" : a.kind === "add" ? `Add in ${this.base(a.row) || "."}/:` : a.kind === "rename" ? `Rename ${a.row.entry.name} to:` : `Delete ${a.row.path}? (y/n)`;
    return h_flex().h(30).flex_none().px(12).gap(6).items_center().border_t(1).border_color(t.border).font_family(font).text_size(12)
      .when(Boolean(a), el => el.child(div().flex_none().text_color(a.kind === "delete" ? t.blocked : t.accent).child(label))
        .child(div().flex_1().min_w(0).child(Input.new(this.input).h(22).text_size(12).text_color(t.foreground))))
      .when(!a && Boolean(this.filter), el => el.child(div().text_color(t.accent).child(`/${this.filter}`)).child(div().text_color(t.dim).child(this.indexing ? "searching…" : "esc clears")))
      .when(!a && !this.filter && Boolean(this.note), el => el.child(div().truncate().text_color(t.blocked).child(this.note)));
  }

  row({ path, entry, depth, found }, here, focused, t) {
    const open = found || this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
    return h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer()
      .when(here, el => el.bg(focused ? t.selected : t.hover)).hover(s => s.bg(t.hover))
      .child(entry.dir ? svg(`mods/nvim-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
      .child(svg(`mods/nvim-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(entry.name))
      .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark)));
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), list = this.shown(), cur = this.at(list), focused = this.handle.is_focused();
    return v_flex().id("files").size_full().on_size_change((size, cx) => { this.height = size.height; })
      .on_key_down((e, cx) => this.key(e, cx)).min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(this.handle.is_focused() ? t.accent : t.border).track_focus(this.handle).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .when(!this.file, el => el.child(div().flex_1().min_h(0).relative().p(6)
        .child(v_virtual_list("files-tree", list.length, 28, (i) => list[i].path, (range) => list.slice(range.start, range.end).map((r, j) => this.row(r, range.start + j === cur, focused, t)))
          .track_scroll(this.scroll).size_full()
          // Rows can't hold handlers in a virtual list: the click comes here with the row's key (its path).
          .on_item_click((path, cx) => { const r = list.find((x) => x.path === path); if (!r) return; this.cursor = path; r.entry.dir ? this.toggle(path, cx) : this.edit(path, cx); cx.notify(); }))
        .child(Scrollbar.vertical("files-tree").viewport_from_layout().absolute().inset_0())
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().absolute().top(6).p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))))
      .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))
      .when(!this.file && Boolean(this.ask || this.filter || this.note), el => el.child(this.cmdline(t)))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
