// Find an agent, like snacks' picker: <leader><space> lists every agent under its status (needs-you first, then by time), each as the agents list
// has it on one line: its icon, what it is on, its buffer, its live sub-agents and how long it has been in its state.
// Tab switches to the status log (every time one needed you or finished, newest first) and back.
// Keys as nvim: j/k (or ↑/↓, ctrl-j/k, ctrl-n/p) move, gg/G the ends, Enter goes there, Esc closes. - or / starts the
// filter (words in any order), as in the explorer: there Enter goes to the selected agent and Esc drops the filter.
// The right half shows the selected agent's screen (hc read), refreshed while open. Props: { mode: "agents" | "log", overlay }.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, panes, run, hc, theme, settings, props, shared, closeOverlay, notify } from "herdr";
import { statusReader, urgency, mark, colour, label } from "./agent-status.js";
import { icon, duration, sinceReader } from "./agent-row.js";
import { namer } from "./name.js";

const ROW = 30;

const pad = (n) => String(n).padStart(2, "0");
function when(ms) {
  const d = new Date(ms), today = new Date().toDateString() === d.toDateString();
  return (today ? "" : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} `) + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// hc read prints what the screen shows; drop any escape codes and the blank lines under the last text.
const clean = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\s+$/, "").split("\n");

export default class AgentFinder extends View {
  init(_props, cx) {
    this.mode = props()?.mode ?? "agents";
    this.filter = "";
    this.at = 0;
    this.top = 0;
    this.preview = { address: null, lines: [] };
    this.handle = cx.focus_handle();
    // The keyboard is on the list until - or / puts it in the filter.
    this.filtering = false;
    this.input = InputState.new({ placeholder: "- to filter" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.top = 0; this.load(cx); cx.notify(); });
    this.input.on("submit", () => this.go(this.rows()[this.at]));
    this.handle.focus();
    cx.timer.after(300, () => { if (!this.filtering) this.handle.focus(); });
    // The selected agent's screen, kept fresh while the dialog is open.
    cx.timer.after(0, (cx) => this.load(cx));
    cx.timer.every(1500, (cx) => this.load(cx, true));
  }

  rows() {
    const live = agents();
    const log = shared("agents.log") ?? [];
    let rows;
    if (this.mode === "log") {
      const byAddr = new Map(live.map((a) => [a.address, a]));
      rows = [...log].reverse().map((e) => ({ ...e, buffer: e.space, key: `${e.address}-${e.at}`, status: e.what, live: byAddr.has(e.address) }));
    } else {
      // Its status as everywhere (agent-status.js), named as the pane header names it (name.js; a bare tab number
      // says nothing: its program then). Its time is the agents list's; until the list has it, its latest log
      // entry dates its "needs you" / "finished" while it still is.
      const last = new Map(log.map((e) => [e.address, e])), read = statusReader(), since = sinceReader(), name = namer();
      rows = live.map((a, i) => {
        const status = read.agent(a.address), who = a.program?.name ?? a.app ?? "agent", on = name(a), l = last.get(a.address);
        return { at: since(a) ?? (l?.what === status ? l.at : null), key: a.address, address: a.address, status, who, program: a.program,
          name: /^\d+$/.test(on) ? who : on, subs: read.subAgents(a.address), buffer: a.space_name, tab: a.tab_name, title: a.title ?? "", order: i, live: true };
      // By status; in each by time: one that needs you or finished longest-waiting first (as the needs-me queue),
      // a working or idle one newest first, so the agent just left is near and the stale sink.
      }).sort((x, y) => urgency(y.status) - urgency(x.status)
        || (x.status === "blocked" || x.status === "done" ? (x.at ?? 0) - (y.at ?? 0) : (y.at ?? 0) - (x.at ?? 0)) || x.order - y.order);
    }
    const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter((r) => { const hay = `${r.name ?? ""} ${r.who} ${r.buffer} ${r.tab} ${r.title} ${label(r.status, "row") ?? r.status}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  }

  load(cx, again = false) {
    const r = this.rows()[this.at];
    const address = r?.live ? r.address : null;
    if (!again && address === this.preview.address) return;
    if (!address) { this.preview = { address: null, lines: [] }; cx.notify(); return; }
    cx.spawn(async (cx) => {
      const out = await hc(["read", address, "--lines", "120"]).catch(() => null);
      // A slower read for a row since left doesn't overwrite the new one.
      if (this.rows()[this.at]?.address !== address) return;
      this.preview = { address, lines: out?.code === 0 ? clean(out.stdout) : ["(can't read this terminal)"] };
      cx.notify();
    });
  }

  close() { closeOverlay(props().overlay); }

  go(r) {
    if (!r) return;
    if (!r.live) return notify({ title: "That agent has ended", level: "info", timeout: 2000 });
    this.close();
    if (!panes().some((p) => p.terminal === r.address)) return run("terminal.peek", { terminal: r.address });
    const ps = panes(), p = ps.find((x) => x.terminal === r.address);
    // As agents-list' zoom.js: unzoom onto it, or the tab keeps drawing the zoomed pane.
    if (p && !p.zoomed && ps.some((q) => q.tab === p.tab && q.zoomed)) run("pane.zoom", { pane: p.pane });
    run("agent.focus", { terminal: r.address });
    run("pane.focus", { terminal: r.address });
  }

  key(e, cx) {
    const k = e.keystroke, n = this.rows().length;
    const g = this.g; this.g = 0;
    const to = (at) => { this.at = Math.max(0, Math.min(n - 1, at)); };
    if (k === "tab") { this.mode = this.mode === "log" ? "agents" : "log"; this.at = 0; this.top = 0; }
    else if (["down", "ctrl-j", "ctrl-n"].includes(k)) to(this.at + 1);
    else if (["up", "ctrl-k", "ctrl-p"].includes(k)) to(this.at - 1);
    // Typing in the filter: the rest is the input's, but Esc, which drops the filter and gives the list the keys back.
    else if (this.filtering) {
      if (k !== "escape") return;
      this.filtering = false; this.filter = ""; this.at = 0; this.top = 0;
      this.input.set_value("");
      this.handle.focus();
    }
    else if (k === "escape" || k === "q") return this.close();
    else if (k === "enter") return this.go(this.rows()[this.at]);
    else if (k === "j") to(this.at + 1);
    else if (k === "k") to(this.at - 1);
    else if (k === "shift-g" || e.key_char === "G") to(n - 1);
    else if (k === "g") { if (g && Date.now() - g < 600) to(0); else this.g = Date.now(); }
    else if (k === "-" || k === "/" || e.key_char === "/") { this.filtering = true; this.input.focus(); }
    else return;
    cx.stop_propagation();
    this.load(cx);
    cx.notify();
  }

  render(cx) {
    const t = theme(), font = settings().font ?? "JetBrains Mono";
    const rows = this.rows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    // What's drawn, top to bottom: the rows, and over each run of one status its header (the agents view only).
    // `at` counts rows alone, so j/k step over the headers.
    const drawn = [];
    rows.forEach((r, i) => {
      if (this.mode !== "log" && r.status !== rows[i - 1]?.status) drawn.push({ head: r.status, count: rows.filter((x) => x.status === r.status).length });
      drawn.push({ r, i });
    });
    // Only the lines that fit are drawn, scrolled just enough to keep the selection in view, with its header when it is the first under it.
    const fit = Math.max(1, Math.floor((this.listH ?? 400) / ROW));
    const sel = drawn.findIndex((l) => l.i === this.at), first = sel > 0 && "head" in drawn[sel - 1] ? sel - 1 : sel;
    if (first < this.top) this.top = Math.max(0, first);
    if (sel >= this.top + fit) this.top = sel - fit + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, drawn.length - fit)));
    const shown = drawn.slice(this.top, this.top + fit);

    const now = Date.now();
    const base = (r, i) => h_flex().id(`ap-${r.key}`).h(ROW).flex_none().px(10).gap(10).items_center().rounded(6)
      .when(i === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).cursor_pointer()
      .on_click(() => this.go(r));
    // An agent: the right-hand columns are fixed, so they line up down the list and the name takes the rest.
    const agentRow = (r, i) => {
      const pic = icon(r.program, 16, t.foreground), news = label(r.status, "row");
      return base(r, i)
        .child(div().w(12).flex_none().child(mark(t, r.status, "row")))
        .child(h_flex().size(16).flex_none().items_center().justify_center().when(Boolean(pic), (el) => el.child(pic)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.name))
        .child(div().w(120).flex_none().truncate().text_color(t.muted).child(r.buffer))
        .child(div().w(28).flex_none().text_size(11).text_color(t.dim).when(r.subs > 0, (el) => el.child(`⑂${r.subs}`)))
        .child(div().w(64).flex_none().text_size(11).text_color(colour(t, r.status)).when(Boolean(news), (el) => el.child(news)))
        .child(h_flex().w(32).flex_none().justify_end().text_size(11).text_color(t.dim).when(Boolean(r.at), (el) => el.child(duration(now - r.at))));
    };
    // A status log entry: when, who, where, and what it said then.
    const logRow = (r, i) => base(r, i)
      .child(div().w(84).flex_none().text_color(t.dim).child(when(r.at)))
      .child(div().w(12).flex_none().child(mark(t, r.status, "row")))
      .child(div().flex_none().max_w(120).truncate().text_color(r.live ? t.foreground : t.dim).child(r.who))
      .child(div().flex_none().max_w(200).truncate().text_color(t.muted).child(`${r.buffer} › ${r.tab}`))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(r.title))
      .when(Boolean(label(r.status, "row")), (el) => el.child(div().flex_none().text_size(11).text_color(colour(t, r.status)).child(label(r.status, "row"))));
    const row = this.mode === "log" ? logRow : agentRow;
    // A status header, as the agents list's shelves: a dim label, then how many.
    const head = (l) => h_flex().id(`ap-h-${l.head}`).h(ROW).flex_none().px(10).gap(8).items_end().pb(5).text_size(11).font_medium().text_color(t.dim)
      .child(div().flex_none().child(label(l.head)))
      .child(div().flex_none().font_normal().child(String(l.count)));

    const empty = this.mode === "log" ? "No status changes yet. They're logged from when this setup started." : "No agents.";
    const fitLines = Math.max(1, Math.floor((this.prevH ?? 400) / 16));
    const lines = this.preview.lines.slice(-fitLines);

    return v_flex().id("agent-finder").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(16).gap(10).bg(t.popover).text_size(13).font_family(font)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(this.mode === "log" ? "Find agent · status log" : "Find agent"))
        .child(div().text_size(11).text_color(t.dim).child(`${this.filtering ? "↑↓ ctrl-j/k" : "j/k"}  ⏎ go  ${this.filtering ? "esc list" : "- filter"}  tab ${this.mode === "log" ? "agents" : "log"}${this.filtering ? "" : "  esc close"}`)))
      .child(h_flex().h(34).flex_none().px(10).items_center().rounded(8).border_1().border_color(this.filtering ? t.accent : t.border).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      // Stretched: an h_flex centres its children at their own height, and a list only as tall as its rows
      // could never show more of them again (rows that fit come from its height).
      .child(h_flex().flex_1().min_h(0).gap(12).items_stretch()
        .child(v_flex().id("ap-list").flex_1().min_w(0).min_h(0).overflow_hidden()
          .on_size_change((size, cx) => { const h = size.height / settings().zoom; if (h !== this.listH) { this.listH = h; cx.notify(); } })
          .when(rows.length === 0, (el) => el.child(div().p(12).text_color(t.dim).child(empty)))
          .children(shown.map((l) => ("head" in l ? head(l) : row(l.r, l.i)))))
        .child(v_flex().id("ap-preview").flex_1().min_w(0).min_h(0).overflow_hidden().justify_end().p(10).rounded(8).bg(t.background).border_1().border_color(t.border)
          .on_size_change((size, cx) => { const h = (size.height / settings().zoom) - 20; if (h !== this.prevH) { this.prevH = h; cx.notify(); } })
          .text_size(12).line_height("16px").text_color(t.foreground)
          .when(!this.preview.address, (el) => el.child(div().text_color(t.dim).child(rows.length ? "(ended: nothing to show)" : "")))
          .children(lines.map((l, i) => div().id(`pl-${i}`).h(16).flex_none().whitespace_nowrap().overflow_hidden().child(l || " ")))));
  }
}
