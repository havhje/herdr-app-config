import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, spaces, panes, agents, run, theme, shared, setShared, layout, settings, nextCommand, exec } from "herdr";
import { record } from "./leader-records.js";
import { statusReader, mark, colour, glyph } from "./agent-status.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Bufferline extends View {
  init(_props, cx) {
    // A second copy (props {role:"tabs"}) draws only the tab row; the rest is the bufferline's job.
    this.role = props()?.role ?? "buffers";
    if (this.role === "tabs") return;
    // ctrl-space (keys.json: bufferline.leader) only shows the leader menu; the leader does the rest. The key is here,
    // not the leader's, because `<mod>.<command>` reaches shown copies only (AGENTS.md) and the leader is hidden until
    // opened. It sits in the sidebar: a hidden sidebar shows for it, and the leader is told so, to hide it on close.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        // <leader><tab>o, once confirmed: the leader is hidden by then, so the closing is done here.
        if (c === "closeOtherTabs") {
          for (const id of shared("tabs.closeOthers") ?? []) run("tab.close", { id });
          setShared("tabs.closeOthers", null);
          continue;
        }
        if (c !== "leader") continue;
        const sidebarHidden = Boolean(find(layout(), "sidebar")?.hidden);
        if (sidebarHidden) run("layout.show", { id: "sidebar" });
        run("layout.show", { id: "leader" });
        // Herdr gives no "now shown" signal, so wait a beat for it to show (and start, the first time).
        cx.timer.after(60, () => run(sidebarHidden ? "leader.openSidebar" : "leader.open"));
      }
    });
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // Worktree buffers show their branch: buffer id -> branch, for linked checkouts only. Polled gently.
    this.worktrees = {};
    this.checkWorktrees(cx);
    cx.timer.every(5000, (cx) => this.checkWorktrees(cx));
    // Zen shrinks this bar to 0 px (it must stay shown for ctrl-space); it may not redraw then, but its timers run:
    // keep the leader's records then too.
    cx.timer.every(1000, () => { if (shared("zen")) record(); });
  }

  // A buffer is a worktree when its git dir isn't its top's own .git (as context-menu's checkout()).
  checkWorktrees(cx) {
    cx.spawn(async (cx) => {
      const next = {}, ps = panes();
      for (const s of spaces()) {
        const tabs = new Set((s.tabs ?? []).map((c) => c.id));
        const cwd = ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
        if (!cwd) continue;
        const r = await exec("sh", ["-c", 'git rev-parse --show-toplevel --path-format=absolute --git-common-dir && git branch --show-current'], { cwd, on: s.machine ?? undefined }).catch(() => null);
        if (r?.code !== 0) continue;
        const [top, common, branch] = r.stdout.split("\n");
        if (common !== `${top}/.git`) next[s.id] = branch || "detached";
      }
      if (JSON.stringify(next) !== JSON.stringify(this.worktrees)) { this.worktrees = next; cx.notify(); }
    });
  }

  // The side panel is remembered per buffer: switching shows that buffer's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(buffer, panel, body, enabled) {
    if (!buffer || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (buffer.id !== this.buffer) {
      const first = this.buffer === undefined;
      this.buffer = buffer.id; this.pending = null;
      if (!(first && !(buffer.id in this.panels))) {
        const stored = this.panels[buffer.id] ?? null, want = enabled.includes(stored) ? stored : null;
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
    if (this.panels[buffer.id] === now) return;
    this.panels[buffer.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  // Two rows, one hierarchy. Top: every buffer by number and name (nvim's bufferline); the shown
  // one is a grey tab that runs down into the row below. Below (a second copy, props {role:"tabs"}):
  // the shown buffer's tabs on that same grey shelf, the shown tab underlined; that row shows only
  // when the buffer has more than one tab (else the buffer is a plain grey pill). Nothing to click:
  // H/L or alt-1..9 switch buffers, rename a tab with <leader>tr.
  render() {
    const t = theme(), all = spaces(), font = settings().font ?? "JetBrains Mono";
    if (this.role === "tabs") return this.renderTabs(t, all, font);
    const root = layout();
    // The leader's records (other buffer, jumplist, status log) are kept as this always-shown bar redraws.
    record();
    // Zen (<leader>uz) hides the tab row and side panel: leave them, and don't record its closed panel as a choice.
    const zen = Boolean(shared("zen"));
    if (!zen) this.syncPanel(all.find(p => p.active), find(root, "panel"), find(root, "panel-body"), shared("workspace.panels") ?? ["files"]);
    const shown = all.find((p) => p.active), st = statusReader();
    const many = tabsShown(shown).length > 1, row = find(root, "tab-row");
    // A row never hidden has no `hidden` yet, so read it as a boolean.
    const rowShown = row && !row.hidden;
    if (row && !zen && rowShown !== many && this.rowWant !== many) { this.rowWant = many; run(many ? "layout.show" : "layout.hide", { id: "tab-row" }); }
    if (row && rowShown === many) this.rowWant = undefined;
    const joined = (p) => p.active && many;
    const buf = (p) => h_flex().h(joined(p) ? 30 : 26).mb(joined(p) ? 0 : 4).flex_none().items_center().gap(7).px(12)
      .when(p.active, el => el.bg(SHELF(t)).rounded(7)).when(joined(p), el => el.rounded_b(0))
      .child(div().text_color(t.dim).child(`${p.index}`))
      .child(div().max_w(220).truncate().text_color(p.active ? t.foreground : t.muted).when(p.active, el => el.font_bold()).child(p.name))
      .when(Boolean(this.worktrees[p.id]), el => el.child(div().max_w(160).truncate().text_color(t.dim).child(`:${this.worktrees[p.id]}`)))
      // The shown buffer's agent status (its most urgent agent's) shows on its tabs when their row is up, so not twice.
      .when(mark(t, st.buffer(p.id), "cell") != null && !joined(p), el => el.child(mark(t, st.buffer(p.id), "cell")));
    // Right: agents across all buffers, by status.
    const words = agents().map((a) => st.agent(a.address));
    const count = (s) => words.filter((w) => w === s).length;
    const seg = (color, text) => div().flex_none().text_color(color).child(text);
    const info = h_flex().h_full().flex_none().items_center().gap(14).px(12).text_size(11)
      .children(["working", "blocked", "done"].filter((s) => count(s) > 0).map((s) => seg(colour(t, s), `${glyph(s)} ${count(s)}`)));
    return h_flex().size_full().min_w(0).items_end().bg(t.chrome).font_family(font).text_size(13)
      .child(h_flex().flex_1().min_w(0).overflow_x_hidden().items_end().gap(2).pl(8).children(all.map(buf)))
      .child(info);
  }

  renderTabs(t, all, font) {
    const ps = panes(), shown = all.find((p) => p.active), st = statusReader();
    // An unnamed tab is called after what runs in it (claude, zsh), not "tab".
    const label = (c) => { if (c.named) return c.name; const x = ps.find((x) => x.tab === c.id && x.focused) ?? ps.find((x) => x.tab === c.id); return x?.app ?? x?.mod ?? "shell"; };
    const tab = (c) => h_flex().h_full().flex_none().items_center().gap(5).px(10)
      // The shown tab's underline is soft (dim, not foreground). The others' is see-through, not the shelf's
      // shade: a theme's border can be see-through itself, and would then show as a faint line on the shelf.
      .border_b(2).border_color(c.active ? t.dim : "#00000000")
      .child(div().text_color(t.dim).child(`${c.index}`))
      .child(div().max_w(180).truncate().text_color(c.active ? t.foreground : t.muted).child(label(c)))
      .when(mark(t, st.tab(c.id), "cell") != null, el => el.child(mark(t, st.tab(c.id), "cell")));
    const tabs = tabsShown(shown);
    // The shelf's top-left corner stays square when the first buffer's tab runs into it.
    // A small gap under it keeps it apart from the pane cards.
    return div().size_full().pb(6).bg(t.chrome).child(h_flex().size_full().min_w(0).px(4).bg(SHELF(t)).rounded(7)
      .when(shown?.index === 1, el => el.rounded_tl(0))
      .font_family(font).text_size(12).overflow_x_hidden().children(tabs.map(tab)));
  }
}

// A buffer's tabs as lists show them: settled ones fold away unless shown.
const tabsShown = (p) => (p?.tabs ?? []).filter((c) => !c.settled || c.active);
// The shown buffer and its tabs share this shade: one step darker than the bar.
const SHELF = (t) => t.border;
