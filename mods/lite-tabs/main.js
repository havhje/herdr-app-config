import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, run, theme, shared, setShared, layout, settings, nextCommand, focused } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    // ctrl-space (keys.json: lite-tabs.leader) shows the leader menu under Agents; it hides itself.
    cx.spawn(async (cx) => {
      for (;;) {
        if (await nextCommand() !== "leader") continue;
        // The leader sits in the sidebar: a hidden sidebar shows for it, and the leader hides it again on close.
        const bar = find(layout(), "sidebar");
        setShared("leader.open", { gen: Date.now(), pane: focused()?.pane ?? null, sidebarHidden: Boolean(bar?.hidden) });
        if (bar?.hidden) run("layout.show", { id: "sidebar" });
        run("layout.show", { id: "leader" });
        // Once it's shown (commands reach shown copies only), hand it the keyboard.
        cx.timer.after(60, () => run("leader.focus"));
      }
    });
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  // Spaces as nvim's bufferline: one cell per space, the shown one on the editor ground with an
  // accent bar on its left. Nothing to click: H/L in NORMAL (modes mod) or alt-1..9 switch.
  render() {
    const t = theme(), root = layout(), all = spaces(), font = settings().font ?? "JetBrains Mono";
    // <leader>bb (leader mod) goes back to the space shown before this one.
    const now = all.find(p => p.active)?.id;
    if (now && this.lastActive && now !== this.lastActive) setShared("leader.prevSpace", this.lastActive);
    this.lastActive = now;
    this.syncPanel(all.find(p => p.active), find(root, "panel"), find(root, "panel-body"), shared("workspace.panels") ?? ["files", "changes"]);
    const mark = (s) => s === "working" ? div().text_color(t.working).child("●")
      : s === "blocked" ? div().text_color(t.blocked).child("!")
      : s === "done" ? div().text_color(t.done).child("●") : null;
    const cell = (p) => h_flex().h_full().flex_none().items_center().gap(6).pr(14)
      .bg(p.active ? t.background : t.chrome).border_r(1).border_color(t.border)
      .child(div().w(10).text_color(p.active ? t.accent : t.chrome).child("▎"))
      .child(div().text_color(t.dim).child(`${p.index}`))
      .child(div().max_w(200).truncate().text_color(p.active ? t.foreground : t.muted).when(p.active, el => el.font_bold()).child(p.name))
      .when(mark(p.status) != null, el => el.child(mark(p.status)));
    return h_flex().size_full().min_w(0).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .font_family(font).text_size(13).overflow_x_hidden()
      .children(all.map(cell));
  }
}
