// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "t3-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status. No buttons (nvim style: <leader>w splits,
// zooms and closes). Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home } from "herdr";
import { modStatus, namer, programOf } from "./name.js";
import { statusReader, mark, label } from "./agent-status.js";
import { tipMark, POINTER_WATCH, pointerAt, pointerGone, pointerMoved } from "./tip.js";
import { stopsInit, stopsEnd, stop, focusRoot } from "./focus.js";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}


export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    stopsInit(this, cx);
  }

  async close() {
    stopsEnd(this);
  }

  // What shows on hover also watches where the pointer is: its leave can be dropped (tip.js).
  headHover(on, cx) {
    this.hovered = on;
    this.box = null;
    this.hoverWatch?.cancel();
    if (on) {
      const from = pointerAt();
      this.hoverWatch = cx.timer.every(POINTER_WATCH, (cx) => {
        if (!pointerGone(this.box, from)) return;
        this.hoverWatch.cancel();
        this.hovered = false;
        cx.notify();
      });
    }
    cx.notify();
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    // Home's default page says nothing of itself: the brand bar's button tells where this is.
    const name = p.mod === "t3-home" ? "" : namer()(p);
    const pic = icon(programOf(p), 14, t.muted);
    // Its agent status, sub-agents in (agent-status.js); a mod pane says its own.
    const st = p.mod ? modStatus(p) : statusReader().agent(p.terminal, p.status);
    const m = mark(t, st, "pane");
    const pane = p.pane;
    // A mark takes the last button's 24px, so it, the × and the tab bar's + share one column: this header's pr(2), the frame's 2 and the block's 8 are the bar's 12.
    const slot = (mark) => div().w(24).flex_none().flex().items_center().justify_center().child(mark);
    const head = `pane-head-${pane}`;
    // The rounded frame paints the background; rectangular child fills would cover its corners.
    return focusRoot(this, stop(this, t, head, h_flex()
      .id(head)
      .size_full()
      // 4 + the frame's 2 is a tab's 6: with its 16px slot and 2 to the name, the icon and first word stand under the first tab's.
      .pl(4)
      .pr(2)
      .gap(12)
      .items_center()
      .text_size(14)
      .on_hover((on, cx) => this.headHover(on, cx))
      .on_mouse_move((e) => { pointerMoved(e.position); this.box = e.bounds; })
      .on_click(() => run("pane.focus", { pane }))
      .child(div().size(16).mr(-10).flex_none().flex().items_center().justify_center().when(Boolean(pic), (el) => el.child(pic)))
      .when(Boolean(p.terminal) && name !== p.terminal, (el) => el.child(div().flex_none().text_color(t.dim).child(p.terminal)))
      .child(div().min_w(0).truncate().font_medium().text_color(p.focused ? t.foreground : t.muted).child(name))
      .child(div().relative().flex_1().min_w(0).h_full().flex().items_center()
        .child(div().flex_1().min_w(0).truncate().pr(12).text_color(t.dim).child(folder(p.cwd)))
      )
      // The agents list's marks; idle draws none.
      .when(Boolean(m), el => el.child(slot(tipMark(this, t, `ph-mark-${pane}`, label(st), m.accessibility_label(label(st)))))), 8));
  }
}
