// which-key for Herdr: ctrl-space opens it at the bottom, like nvim's leader popup.
// It lists the keys that can come next; a group (b, w, t) shows its own keys; Esc or backspace goes back/closes.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, spaces, layout, shared, settings, nextCommand } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

// The side panel: show this child, or hide it when it's already the one shown.
const panel = (child) => () => {
  const p = find(layout(), "panel"), body = find(layout(), "panel-body");
  if (p && !p.hidden && body?.active === child) run("layout.hide", { id: "panel" });
  else { run("layout.select", { stack: "panel-body", child }); run("layout.show", { id: "panel" }); }
};
const cmd = (name, args) => () => run(name, args);
const active = () => spaces().find((s) => s.active);

const TREE = {
  b: { label: "+buffer", keys: {
    n: ["Next buffer", cmd("space.next")],
    p: ["Prev buffer", cmd("space.prev")],
    b: ["Other buffer", () => { const id = shared("leader.prevSpace"); if (id && spaces().some((s) => s.id === id)) run("space.select", { id }); }],
    d: ["Delete buffer", () => run("space.close", { id: active()?.id })],
    r: ["Rename buffer", () => run("space.rename", { id: active()?.id })],
    N: ["New buffer", cmd("space.new")],
  } },
  w: { label: "+windows", keys: {
    v: ["Split right", cmd("pane.split", { direction: "right" })],
    s: ["Split below", cmd("pane.split", { direction: "down" })],
    d: ["Delete window", cmd("pane.close")],
    m: ["Maximize toggle", cmd("pane.zoom")],
    h: ["Go left", cmd("pane.go", { direction: "left" })],
    j: ["Go down", cmd("pane.go", { direction: "down" })],
    k: ["Go up", cmd("pane.go", { direction: "up" })],
    l: ["Go right", cmd("pane.go", { direction: "right" })],
  } },
  t: { label: "+tabs", keys: {
    n: ["New tab", cmd("tab.new")],
    d: ["Close tab", cmd("tab.close")],
    r: ["Rename tab", cmd("tab.rename")],
    l: ["Next tab", cmd("tab.next")],
    h: ["Prev tab", cmd("tab.prev")],
  } },
  e: ["Explorer (files)", panel("files")],
  g: ["Git changes", panel("changes")],
  a: ["Agents", cmd("t3-agents.focus")],
  f: ["Find in terminal", cmd("terminal.search")],
  ":": ["Command palette", cmd("app.palette")],
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), [`Buffer ${n}`, cmd("space.select", { index: n })]])),
};

export default class Leader extends View {
  init(_props, cx) {
    this.h = cx.focus_handle();
    this.path = [];
    // lite-tabs shows the panel on us (ctrl-space), then sends "focus": take the keyboard, start at the top.
    cx.spawn(async (cx) => {
      for (;;) {
        if (await nextCommand() !== "focus") continue;
        this.path = []; this.h.focus(); cx.notify();
      }
    });
  }

  // Hide again, and give the keyboard back to the pane we came from.
  close() {
    const open = shared("leader.open");
    run("layout.hide", { id: "leader" });
    if (open?.pane) run("pane.focus", { pane: open.pane });
  }

  key(e, cx) {
    cx.stop_propagation();
    if (e.key === "escape") return this.close();
    if (e.key === "backspace") { if (this.path.length) { this.path.pop(); cx.notify(); } else this.close(); return; }
    const k = e.key_char ?? e.key;
    const entry = this.level().keys[k];
    if (!entry) return;
    if (!Array.isArray(entry)) { this.path.push(k); cx.notify(); return; }
    this.close();
    entry[1]();
  }

  level() {
    let node = { keys: TREE };
    for (const k of this.path) node = node.keys[k];
    return node;
  }

  render(cx) {
    const t = theme(), font = settings().font ?? "JetBrains Mono";
    const entries = Object.entries(this.level().keys).filter(([k]) => this.path.length || !/^[2-9]$/.test(k));
    const row = ([k, v]) => {
      const group = !Array.isArray(v);
      return h_flex().h(22).gap(10).items_center()
        .child(div().w(28).text_color(t.accent).font_bold().child(k === "1" && !this.path.length ? "1-9" : k))
        .child(div().text_color(t.dim).child("→"))
        .child(div().flex_1().min_w(0).truncate().text_color(group ? t.ansi5 : t.foreground).child(group ? v.label : (k === "1" && !this.path.length ? "Buffer N" : v[0])));
    };
    const crumb = ["<leader>", ...this.path].join(" ");
    return v_flex().id("leader").size_full().min_h(0).track_focus(this.h).on_key_down((e, cx) => this.key(e, cx))
      .m(8).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(this.h.is_focused() ? t.accent : t.border)
      .font_family(font).text_size(13).text_color(t.foreground)
      .child(h_flex().h(42).flex_none().px(14).items_center().border_b(1).border_color(t.border).child(div().font_semibold().child(crumb)))
      .child(v_flex().flex_1().min_h(0).px(14).py(10).gap(2).children(entries.map(row)))
      .child(div().px(14).py(8).text_size(11).text_color(t.dim).child("esc close  ⌫ back"));
  }
}
