// The links pane, under the explorer: the URLs and non-code files (pages, pictures, pdfs, notes) the focused agent
// has printed (not svg: those are mostly icons the agent is coding), newest first. It reads that agent's visible screen (hc read) when the agent finishes
// (working to anything else), when the pane is opened and the first time an agent is followed, and remembers what it saw,
// because it never reads the agent's history. Files must exist and not be tracked by git; a gone one drops out. Keys as nvim: j/k, gg/G,
// enter/l opens, cc copies, p pins, q hides the pane, esc back to the terminals. <leader>ul shows and hides it.
// A pinned link stays on top for every agent, when its file is gone and after a restart (localStorage), until p unpins it.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { focused, panes, layout, hc, exec, home, theme, settings, nextCommand, run, notify } from "herdr";

// TICK only looks at the agent's status (in memory); the screen is read on the events above, not on a clock.
const TICK = 1000, KEEP = 200;
const OPEN_IN_NVIM = new Set(["md", "txt", "csv"]);
const URL = /https?:\/\/[^\s"'<>`)\]}│]+/g;
const FILE = /(?:file:\/\/)?(?:~|\.{1,2})?\/?[\w@%+~.\/-]*[\w-]\.(?:html?|png|jpe?g|gif|webp|pdf|md|txt|csv|mp4|webm|mov)(?![\w\/-]|\.\w)/gi;
// hc read prints what the screen shows: drop escape codes.
const clean = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");

// Every link in a screen's text, in the order printed: URLs (their trailing punctuation off), then paths outside them.
export function linksIn(text) {
  const out = [];
  for (const line of clean(text).split("\n")) {
    if (/\S{300}/.test(line)) continue;
    const found = [];
    const rest = line.replace(URL, (u, at) => { found.push([at, u.replace(/[.,;:!?'"]+$/, "")]); return " ".repeat(u.length); });
    for (const m of rest.matchAll(FILE)) found.push([m.index, m[0].replace(/^file:\/\//, "")]);
    for (const [, l] of found.sort((a, b) => a[0] - b[0])) out.push(l);
  }
  return out;
}

// Herdr keeps a hidden copy's timers running: read nothing unless the pane and the side panel are shown.
function shownNow() {
  const find = (n, id) => n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean) ?? null;
  const l = layout();
  return !find(l, "links")?.hidden && !find(l, "panel")?.hidden;
}

const isUrl = (l) => /^https?:/.test(l);
// The machine an agent's address names ("vps/t7"); none for one here.
const machine = (address) => address?.includes("/") ? address.split("/")[0] : undefined;
const ext = (l) => (/\.(\w+)$/.exec(l)?.[1] ?? "").toLowerCase();

export default class Links extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.agent = null; this.byAgent = new Map(); this.cursor = null; this.g = 0; this.c = 0; this.reading = false;
    this.status = new Map(); this.tried = new Set(); this.wasShown = false;
    this.pins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    cx.spawn(async (cx) => { for (;;) { if (await nextCommand() === "focus") { this.handle.focus(); cx.notify(); } } });
    this.tick(cx);
    cx.timer.every(TICK, (cx) => this.tick(cx));
  }

  // Reads the followed agent's screen when it has just finished, when the pane has just been shown, or when it was never read.
  tick(cx) {
    const address = this.follow(), shown = shownNow(), opened = shown && !this.wasShown;
    this.wasShown = shown;
    if (!address) return;
    const status = panes().find((p) => p.terminal === address)?.status ?? null, before = this.status.get(address);
    this.status.set(address, status);
    if (!shown) return;
    if (opened || !this.tried.has(address) || (before === "working" && status !== "working")) this.poll(cx);
  }

  // The agent to follow: the focused one, else the last one focused (the keyboard may be here or in the explorer).
  follow() {
    const a = focused()?.agent;
    if (a) this.agent = a;
    return this.agent;
  }

  poll(cx) {
    const address = this.follow();
    if (!address || !shownNow()) return;
    // A finish while a read runs: read again after it.
    if (this.reading) { this.again = true; return; }
    const pane = panes().find((p) => p.terminal === address), cwd = pane?.cwd ?? null;
    const on = machine(address);
    this.reading = true; this.tried.add(address);
    cx.spawn(async (cx) => {
      try {
        // The visible screen only. A history read (--lines) makes the core scroll a full-screen agent to stitch its
        // history: seconds each time its screen has changed, in the terminal I am typing in.
        const r = await hc(["read", address]).catch(() => null);
        if (r?.code !== 0) return;
        // seen: every raw link read so far (so each is resolved once); items: the ones that are there, newest first.
        const mem = this.byAgent.get(address) ?? { seen: new Set(), items: [] }, now = Date.now();
        const fresh = [...new Set(linksIn(r.stdout))].filter((l) => !mem.seen.has(l));
        for (const l of fresh) mem.seen.add(l);
        // Later on the screen is newer.
        let add = fresh.map((raw, i) => ({ link: isUrl(raw) ? raw : this.full(raw, cwd), at: now + i })).filter((e) => e.link);
        // Files the repo tracks (CLAUDE.md, docs) are the agent's work, not something it made for me: left out, checked once.
        const newFiles = add.map((e) => e.link).filter((l) => !isUrl(l));
        const tracked = newFiles.length ? await this.tracked(newFiles, on) : new Set();
        add = add.filter((e) => !tracked.has(e.link));
        const all = [...add, ...mem.items];
        const files = [...new Set(all.map((e) => e.link).filter((l) => !isUrl(l)))];
        const there = files.length ? await this.existing(files, on) : new Set();
        if (!there) return;
        const links = new Set();
        const before = mem.items.map((e) => e.link).join("\n");
        mem.items = all.filter((e) => (isUrl(e.link) || there.has(e.link)) && !links.has(e.link) && links.add(e.link))
          .sort((a, b) => b.at - a.at).slice(0, KEEP);
        this.byAgent.set(address, mem);
        if (mem.items.map((e) => e.link).join("\n") !== before || this.drawn !== address) { this.drawn = address; cx.notify(); }
      } finally { this.reading = false; if (this.again) { this.again = false; this.poll(cx); } }
    });
  }

  full(raw, cwd) {
    if (raw.startsWith("~/")) return home() + raw.slice(1);
    if (raw.startsWith("/")) return raw;
    if (!cwd) return null;
    const parts = [];
    for (const p of `${cwd}/${raw}`.split("/")) { if (p === "..") parts.pop(); else if (p && p !== ".") parts.push(p); }
    return "/" + parts.join("/");
  }

  // The files git tracks, each in its own folder's repo.
  async tracked(files, on) {
    const r = await exec("sh", ["-c", 'for p; do git -C "${p%/*}" ls-files --error-unmatch -- "$p" >/dev/null 2>&1 && printf "%s\\0" "$p"; done; true', "tracked", ...files], { on }).catch(() => null);
    return new Set(r?.code === 0 ? r.stdout.split("\0").filter(Boolean) : []);
  }

  // The files that exist, on the agent's machine; null when that can't be asked.
  async existing(files, on) {
    const r = await exec("sh", ["-c", 'for p; do [ -e "$p" ] && printf "%s\\0" "$p"; done; true', "links", ...files], { on }).catch(() => null);
    return r?.code === 0 ? new Set(r.stdout.split("\0").filter(Boolean)) : null;
  }

  // The pinned links (last pinned on top), then the followed agent's that aren't pinned.
  shown() {
    const pinned = new Set(this.pins.map((p) => p.link));
    return [...this.pins.map((p) => ({ ...p, pinned: true })), ...(this.byAgent.get(this.agent)?.items ?? []).filter((e) => !pinned.has(e.link))];
  }

  // Pins the row, or unpins a pinned one. A pin keeps its machine: the pane may follow another agent when it's opened.
  pin(row, cx) {
    this.pins = row.pinned ? this.pins.filter((p) => p.link !== row.link) : [{ link: row.link, on: machine(this.agent) ?? null }, ...this.pins];
    localStorage.setItem("pins", JSON.stringify(this.pins));
    this.cursor = row.link;
    cx.notify();
  }

  open(e) {
    if (isUrl(e.link)) return this.run("xdg-open", [e.link]);
    if (e.pinned ? e.on : machine(this.agent)) return notify({ title: "That file is on another machine", body: "cc copies its path", level: "info", timeout: 2500 });
    if (OPEN_IN_NVIM.has(ext(e.link))) return this.run("omarchy-launch-editor", [e.link]);
    this.run("xdg-open", [e.link]);
  }

  run(cmd, args, done) {
    exec(cmd, args)
      .then((r) => { if (r.code !== 0) throw new Error(r.stderr.trim() || `${cmd} failed`); done?.(); })
      .catch((err) => notify({ title: `Could not ${cmd === "wl-copy" ? "copy" : "open"} ${args.at(-1)}`, body: String(err.message ?? err), level: "error" }));
  }

  move(list, i, cx) {
    if (!list.length) return;
    this.cursor = list[Math.max(0, Math.min(list.length - 1, i))].link;
    cx.notify();
  }

  key(e, cx) {
    const k = e.keystroke, list = this.shown(), i = Math.max(0, list.findIndex((x) => x.link === this.cursor)), row = list[i];
    const g = this.g, c = this.c; this.g = 0; this.c = 0;
    const twice = (t) => t && Date.now() - t < 600;
    if (k === "j" || k === "down") this.move(list, i + 1, cx);
    else if (k === "k" || k === "up") this.move(list, i - 1, cx);
    else if (e.key_char === "G" || k === "shift-g") this.move(list, list.length - 1, cx);
    else if (k === "g") { if (twice(g)) this.move(list, 0, cx); else this.g = Date.now(); }
    else if ((k === "enter" || k === "l") && row) this.open(row);
    else if (k === "c") { if (twice(c)) { if (row) this.run("wl-copy", ["--", row.link], () => notify({ title: "Copied", body: row.link, timeout: 2000 })); } else this.c = Date.now(); }
    else if (k === "p") { if (row) this.pin(row, cx); }
    else if (k === "q") { run("pane.go", { direction: "right" }); run("layout.hide", { id: "links" }); }
    else if (k === "escape") run("pane.go", { direction: "right" });
    else return;
    cx.stop_propagation();
  }

  row(e, here, t) {
    const url = isUrl(e.link), name = url ? e.link.replace(/^https?:\/\//, "") : e.link.slice(e.link.lastIndexOf("/") + 1);
    const where = url ? "" : e.link.slice(0, e.link.lastIndexOf("/")).replace(/^\/home\/[^/]+/, "~");
    return h_flex().id(`link-${e.link}`).h(26).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
      .when(here, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_ev, cx) => { this.cursor = e.link; this.open(e); cx.notify(); })
      .child(div().w(34).flex_none().text_size(11).text_color(url ? t.accent : t.dim).child(url ? "url" : ext(e.link)))
      .child(div().flex_none().max_w(200).truncate().text_color(t.foreground).child(name))
      .child(div().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().text_ellipsis_start().text_size(11).text_color(t.dim).child(where))
      .when(e.pinned, (el) => el.child(div().flex_none().text_color(t.accent).child("•")));
  }

  render(cx) {
    const t = theme(), list = this.shown(), focused = this.handle.is_focused();
    const at = Math.max(0, list.findIndex((x) => x.link === this.cursor));
    const rows = list.map((e, i) => this.row(e, focused && i === at, t)), pins = list.filter((e) => e.pinned).length;
    // A line between the pinned links and the agent's.
    if (pins && pins < rows.length) rows.splice(pins, 0, div().h(1).flex_none().mx(8).my(4).bg(t.border));
    return v_flex().id("links").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .border_1().border_color(focused ? t.accent : t.border).track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(36).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Links"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.agent ?? "")))
      .child(v_flex().id("links-list").flex_1().min_h(0).p(6).overflow_y_scroll().font_family(settings().font ?? "JetBrains Mono").text_size(12)
        .children(rows.length ? rows
          : [div().p(8).text_color(t.dim).child(this.agent ? "No links yet" : "No agent focused yet")]));
  }
}
