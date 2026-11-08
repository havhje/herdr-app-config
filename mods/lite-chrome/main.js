import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, props, updates } from "herdr";
import { tip, glow } from "./tip.js";
import { stopsInit, stopsEnd, stop, focusRoot } from "./focus.js";

export default class WorkspaceChrome extends View {
  async close() { stopsEnd(this); }

  init(_props, cx) {
    stopsInit(this, cx);
  }

  render() {
    const t = theme();
    if (props()?.footer) {
      // Once Herdr has downloaded an update, its restart at the end of the row.
      const ready = updates().app.ready;
      // T3's footer: 8 in and 4 above its row, whatever height the layout gives the block.
      return focusRoot(this, div().size_full().bg(t.chrome).px(8).pt(4).child(h_flex().h(32).gap(4).items_center()
        .child(div().flex_1())
        .when(Boolean(ready), el => el.child(tip(this, t, "app-update", `Update ${ready} downloaded. Click to restart`, stop(this, t, "app-update", div().id("app-update").h(32).px(12).flex_none().flex().items_center()
          .rounded_full().bg(t.accent + "26").text_size(12).text_color(t.accent).hover(s => s.bg(t.accent + "40")).on_hover(glow(this, "app-update"))
          .role("button").accessibility_label(`Restart into Herdr ${ready}`)
          .on_click(() => run("app.update")).child("Update"), 16))))));
    }
    // lite: the brand bar is a bare drag strip, nothing to click (ctrl-shift-b still toggles the sidebar).
    return div().id("brand").size_full().bg(t.chrome);
  }
}
