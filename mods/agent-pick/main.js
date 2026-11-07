// Find an agent, like snacks' picker: <leader><space> lists every agent (needs-you first, with when it
// needed you or finished); tab switches to the status log (every such change, newest first) and back. Type to filter (words in any order),
// ↑/↓, ctrl-j/k or ctrl-n/p to move, Enter to go there, Esc to close. The right half shows the
// selected agent's screen (hc read), refreshed while open. Props: { mode: "agents" | "log", overlay }.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, panes, run, hc, theme, settings, props, shared, closeOverlay, notify } from "herdr";

const RANK = { blocked: 3, done: 2, working: 1, idle: 0 };
const GLYPH = { working: "●", blocked: "!", done: "✓", idle: "○" };
const WORD = { blocked: "needs you", done: "finished" };
const ROW = 30;

const pad = (n) => String(n).padStart(2, "0");
function when(ms) {
  const d = new Date(ms), today = new Date().toDateString() === d.toDateString();
  return (today ? "" : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} `) + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// hc read prints what the screen shows; drop any escape codes and the blank lines under the last text.
const clean = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\s+$/, "").split("\n");

export default class AgentPick extends View {
  init(_props, cx) {
    this.mode = props()?.mode ?? "agents";
    this.filter = "";
    this.at = 0;
    this.top = 0;
    this.preview = { address: null, lines: [] };
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Find an agent…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.top = 0; this.load(cx); cx.notify(); });
    this.input.on("submit", () => this.go(this.rows()[this.at]));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
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
      rows = [...log].reverse().map((e) => ({ ...e, key: `${e.address}-${e.at}`, status: e.what, live: byAddr.has(e.address) }));
    } else {
      // Its latest log entry dates its "needs you" / "finished" while it still is.
      const last = new Map(log.map((e) => [e.address, e]));
      rows = live.map((a, i) => ({ at: last.get(a.address)?.what === a.status ? last.get(a.address).at : null, key: a.address, address: a.address, status: a.status, who: a.program?.name ?? a.app ?? "agent", space: a.space_name, tab: a.tab_name, title: a.title ?? "", order: i, live: true }))
        .sort((x, y) => RANK[y.status] - RANK[x.status] || x.order - y.order);
    }
    const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter((r) => { const hay = `${r.who} ${r.space} ${r.tab} ${r.title} ${WORD[r.status] ?? r.status}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
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
    // As t3-agents' zoom.js: unzoom onto it, or the tab keeps drawing the zoomed pane.
    if (p && !p.zoomed && ps.some((q) => q.tab === p.tab && q.zoomed)) run("pane.zoom", { pane: p.pane });
    run("agent.focus", { terminal: r.address });
    run("pane.focus", { terminal: r.address });
  }

  key(e, cx) {
    const k = e.keystroke, n = this.rows().length;
    if (k === "escape") return this.close();
    if (k === "tab") { this.mode = this.mode === "log" ? "agents" : "log"; this.at = 0; this.top = 0; cx.stop_propagation(); this.load(cx); cx.notify(); return; }
    if (["down", "ctrl-j", "ctrl-n"].includes(k)) this.at = Math.min(n - 1, this.at + 1);
    else if (["up", "ctrl-k", "ctrl-p"].includes(k)) this.at = Math.max(0, this.at - 1);
    else return;
    cx.stop_propagation();
    this.load(cx);
    cx.notify();
  }

  render(cx) {
    const t = theme(), font = settings().font ?? "JetBrains Mono";
    const rows = this.rows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    // Only the rows that fit are drawn, scrolled just enough to keep the selection in view.
    const fit = Math.max(1, Math.floor((this.listH ?? 400) / ROW));
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + fit) this.top = this.at - fit + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, rows.length - fit)));
    const shown = rows.slice(this.top, this.top + fit);
    const hue = (s) => t[s] ?? t.dim;

    const row = (r, i) => {
      const on = this.top + i === this.at;
      return h_flex().id(`ap-${r.key}`).h(ROW).flex_none().px(10).gap(10).items_center().rounded(6)
        .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).cursor_pointer()
        .on_click(() => this.go(r))
        .when(this.mode === "log", (el) => el.child(div().w(84).flex_none().text_color(t.dim).child(when(r.at))))
        .child(div().w(12).flex_none().text_color(hue(r.status)).child(GLYPH[r.status] ?? "·"))
        .child(div().flex_none().max_w(120).truncate().text_color(r.live ? t.foreground : t.dim).child(r.who))
        .child(div().flex_none().max_w(200).truncate().text_color(t.muted).child(`${r.space} › ${r.tab}`))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(r.title))
        .when(Boolean(WORD[r.status]), (el) => el.child(div().flex_none().text_size(11).text_color(hue(r.status)).child(WORD[r.status] + (this.mode !== "log" && r.at ? ` ${when(r.at)}` : ""))));
    };

    const empty = this.mode === "log" ? "No status changes yet. They're logged from when this setup started." : "No agents.";
    const fitLines = Math.max(1, Math.floor((this.prevH ?? 400) / 16));
    const lines = this.preview.lines.slice(-fitLines);

    return v_flex().id("agent-pick").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(16).gap(10).bg(t.popover).text_size(13).font_family(font)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(this.mode === "log" ? "Find agent · status log" : "Find agent"))
        .child(div().text_size(11).text_color(t.dim).child(`↑↓ ctrl-j/k  ⏎ go  tab ${this.mode === "log" ? "agents" : "log"}  esc close`)))
      .child(h_flex().h(34).flex_none().px(10).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(h_flex().flex_1().min_h(0).gap(12)
        .child(v_flex().id("ap-list").flex_1().min_w(0).min_h(0).overflow_hidden()
          .on_size_change((size, cx) => { const h = size.height / settings().zoom; if (h !== this.listH) { this.listH = h; cx.notify(); } })
          .when(rows.length === 0, (el) => el.child(div().p(12).text_color(t.dim).child(empty)))
          .children(shown.map(row)))
        .child(v_flex().id("ap-preview").flex_1().min_w(0).min_h(0).overflow_hidden().justify_end().p(10).rounded(8).bg(t.background).border_1().border_color(t.border)
          .on_size_change((size, cx) => { const h = (size.height / settings().zoom) - 20; if (h !== this.prevH) { this.prevH = h; cx.notify(); } })
          .text_size(12).line_height("16px").text_color(t.foreground)
          .when(!this.preview.address, (el) => el.child(div().text_color(t.dim).child(rows.length ? "(ended: nothing to show)" : "")))
          .children(lines.map((l, i) => div().id(`pl-${i}`).h(16).flex_none().whitespace_nowrap().overflow_hidden().child(l || " ")))));
  }
}
