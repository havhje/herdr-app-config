// which-key for Herdr: ctrl-space opens it at the bottom, like nvim's leader popup.
// It lists the keys that can come next; a group (b, w, <tab>) shows its own keys; Esc or backspace goes back/closes.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, spaces, panes, layout, shared, setShared, settings, focused, nextCommand, openOverlay } from "herdr";
import { nextNeed, jumpBy, zen, killAgent, closeOtherTabs } from "./jump.js";

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
// Herdr's worktree dialog (mods/worktree) for the shown buffer: new, open (pick a checkout) or remove.
// Remove asks first, closes the buffer and runs git worktree remove; the branch stays.
const worktree = (action) => () => openOverlay({ mod: "worktree", kind: "dialog", ...(action === "open" ? { width: 560, height: 480 } : { width: 460, height: 280 }),
  props: { space: active()?.id, folder: panes().find((p) => p.focused)?.cwd, action } });

// The agent finder (mods/agent-finder); tab in it shows the status log.
const pick = (mode) => openOverlay({ mod: "agent-finder", kind: "dialog", width: 0.8, height: 0.75, props: { mode } });

const otherBuffer = () => { const id = shared("leader.otherBuffer"); if (id && spaces().some((s) => s.id === id)) run("space.select", { id }); };

// Like my nvim: next/prev live only under ¨/å, its ]/[ (the keys where ] and [ sit on a US keyboard;
// needs the Norwegian layout without dead keys). The leader groups hold actions.
const TREE = {
  " ": ["Find agent", () => pick("agents")],
  "?": ["Key help", cmd("app.help")],
  o: ["Jump back", () => jumpBy(-1)],
  i: ["Jump forward", () => jumpBy(1)],
  "¨": { label: "+next", keys: {
    a: ["Agent that needs me", (open) => nextNeed(1, open)],
    b: ["Buffer", cmd("space.next")],
    t: ["Tab", cmd("tab.next")],
  } },
  "å": { label: "+prev", keys: {
    a: ["Agent that needs me", (open) => nextNeed(-1, open)],
    b: ["Buffer", cmd("space.prev")],
    t: ["Tab", cmd("tab.prev")],
  } },
  b: { label: "+buffer", keys: {
    b: ["Other buffer", otherBuffer],
    d: ["Delete buffer", () => run("space.close", { id: active()?.id })],
    R: ["Rename buffer", () => run("space.rename", { id: active()?.id })],
    N: ["New buffer", cmd("space.new")],
  } },
  w: { label: "+panes", keys: {
    v: ["Split right", cmd("pane.split", { direction: "right" })],
    s: ["Split below", cmd("pane.split", { direction: "down" })],
    d: ["Close pane", cmd("pane.close")],
    m: ["Maximize toggle", cmd("pane.zoom")],
    h: ["Go left", cmd("pane.go", { direction: "left" })],
    j: ["Go down", cmd("pane.go", { direction: "down" })],
    k: ["Go up", cmd("pane.go", { direction: "up" })],
    l: ["Go right", cmd("pane.go", { direction: "right" })],
  } },
  // LazyVim's <leader><tab> tabs group.
  tab: { label: "+tabs", keys: {
    tab: ["New tab", cmd("tab.new")],
    // LazyVim's ] and [ here, as ¨ and å (see +next/+prev).
    "¨": ["Next tab", cmd("tab.next")],
    "å": ["Previous tab", cmd("tab.prev")],
    d: ["Close tab", cmd("tab.close")],
    r: ["Rename tab", cmd("tab.rename")],
    f: ["First tab", () => { const c = active()?.tabs?.[0]; if (c) run("tab.select", { id: c.id }); }],
    l: ["Last tab", () => { const c = active()?.tabs?.at(-1); if (c) run("tab.select", { id: c.id }); }],
    o: ["Close other tabs (asks first)", closeOtherTabs],
  } },
  e: ["Explorer (files)", panel("files")],
  g: { label: "+git", keys: {
    // The explorer's changed-only view (gs in the explorer switches back).
    g: ["Git changes", () => { run("layout.select", { stack: "panel-body", child: "files" }); run("layout.show", { id: "panel" }); setShared("files.changed", Date.now()); }],
    w: ["New worktree", worktree("new")],
    o: ["Open worktree", worktree("open")],
    d: ["Remove worktree (deletes its folder)", worktree("remove")],
  } },
  a: { label: "+agents", keys: {
    // Shown: hide the sidebar. Hidden (the leader showed it just for itself): keep it and give the list the keyboard.
    a: ["Toggle agents", (open) => {
      if (open?.sidebarHidden) run("agents-list.focus");
      else { run("layout.hide", { id: "sidebar" }); }
    }, { keepSidebar: true }],
    i: ["Toggle idle agents", () => setShared("agents.hideIdle", !shared("agents.hideIdle"))],
    g: ["Toggle grouping (buffer/status)", () => setShared("agents.sort", shared("agents.sort") === "grouped" ? "priority" : "grouped")],
    p: ["Pin/unpin agent", () => {
      const a = focused()?.agent, pins = shared("agents.pins") ?? [];
      if (a) setShared("agents.pins", pins.includes(a) ? pins.filter((p) => p !== a) : [...pins, a]);
    }],
    d: ["Kill agent (asks first)", (open) => killAgent(open)],
  } },
  u: { label: "+ui", keys: {
    s: ["Settings", cmd("app.settings")],
    m: ["Add machine", cmd("mod.open", { name: "machine-add" })],
    l: ["Next layout", cmd("layout.switch")],
    C: ["Theme (colorscheme)", cmd("app.settings", { section: "look" })],
    z: ["Zen mode toggle", (open) => zen(open)],
  } },
};

// The order nvim's which-key shows keys in (its default sort: group, alphanum, mod, then natural, case), so a key sits
// where it would in nvim. Space and tab count as which-key's "<Space>" and "<Tab>". ¨ (next) sorts before å (prev).
const wkKey = (k) => (k === " " ? "<Space>" : k === "tab" ? "<Tab>" : k);
const SORTERS = [
  ([, v]) => (Array.isArray(v) ? 0 : 1),
  ([k]) => (/^[A-Za-z0-9]+$/.test(wkKey(k)) ? 0 : 1),
  ([k]) => (/^<.*>$/.test(wkKey(k)) ? 0 : 1),
  ([k]) => wkKey(k).replace(/\d+/g, (d) => d.padStart(9, "0")).toLowerCase(),
  ([k]) => (wkKey(k).toLowerCase() === wkKey(k) ? 0 : 1),
];
const byWhichKey = (a, b) => {
  for (const f of SORTERS) { const x = f(a), y = f(b); if (x !== y) return x < y ? -1 : 1; }
  return 0;
};

export default class Leader extends View {
  init(_props, cx) {
    this.h = cx.focus_handle();
    this.path = [];
    // ctrl-space: bufferline shows us (and the sidebar, if hidden), then sends "open", or "openSidebar" when it had to
    // show the sidebar. Note where we came from, take the keyboard, start at the top.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c !== "open" && c !== "openSidebar") continue;
        setShared("leader.open", { gen: Date.now(), pane: focused()?.pane ?? null, sidebarHidden: c === "openSidebar" });
        this.path = []; this.h.focus(); cx.notify();
      }
    });
  }

  // Hide again, and give the keyboard back to the pane we came from.
  close(keepSidebar = false) {
    const open = shared("leader.open");
    run("layout.hide", { id: "leader" });
    if (open?.sidebarHidden && !keepSidebar) run("layout.hide", { id: "sidebar" });
    if (open?.pane) run("pane.focus", { pane: open.pane });
  }

  key(e, cx) {
    cx.stop_propagation();
    if (e.key === "escape") return this.close();
    if (e.key === "backspace") { if (this.path.length) { this.path.pop(); cx.notify(); } else this.close(); return; }
    const k = e.key === "space" ? " " : e.key === "tab" ? "tab" : (e.key_char ?? e.key);
    const entry = this.level().keys[k];
    if (!entry) return;
    if (!Array.isArray(entry)) { this.path.push(k); cx.notify(); return; }
    const open = shared("leader.open");
    this.close(Boolean(entry[2]?.keepSidebar));
    entry[1](open);
  }

  level() {
    let node = { keys: TREE };
    for (const k of this.path) node = node.keys[k];
    return node;
  }

  render(cx) {
    const t = theme(), font = settings().font ?? "JetBrains Mono";
    const entries = Object.entries(this.level().keys).sort(byWhichKey);
    const row = ([k, v]) => {
      const group = !Array.isArray(v);
      return h_flex().h(22).gap(10).items_center()
        .child(div().w(28).text_color(t.accent).font_bold().child(k === " " ? "SPC" : k === "tab" ? "TAB" : k))
        .child(div().text_color(t.dim).child("→"))
        .child(div().flex_1().min_w(0).truncate().text_color(group ? t.ansi5 : t.foreground).child(group ? v.label : v[0]));
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
