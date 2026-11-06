// Demoscene scroller: live Herdr facts marching right to left in the IBM VGA
// 8x16 font. Moves one character per frame with .frames(), so it animates
// natively and costs nothing while hidden. Rebuilt when agents or spaces change.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, spaces, theme, settings } from "herdr";

const FONT = "PxPlus IBM VGA 8x16";
const SEP = "  ■  "; // CP437 block, part of the font
const STEP_MS = 110;

export default class Scroller extends View {
  init() { this.cols = 48; }

  message() {
    const list = agents();
    const count = (s) => list.filter((a) => a.status === s).length;
    const names = [...new Set(list.map((a) => (a.program?.name ?? a.app ?? "").toUpperCase()).filter(Boolean))];
    const space = spaces().find((s) => s.active);
    const parts = [
      "HERDR",
      `${list.length} ${list.length === 1 ? "AGENT" : "AGENTS"} ONLINE`,
      count("working") && `${count("working")} WORKING`,
      count("blocked") && `${count("blocked")} WAITING FOR YOU`,
      count("done") && `${count("done")} DONE`,
      space && `SPACE ${space.name.toUpperCase()}${space.branch ? " ON " + space.branch.toUpperCase() : ""}`,
      names.length && `GREETINGS TO ${names.join(" + ")}`,
      "SYNTHWAVE DAYLIGHT",
    ].filter(Boolean);
    return parts.join(SEP) + SEP;
  }

  render() {
    const t = theme();
    const zoom = Number(settings().zoom ?? 1);
    const msg = this.message();
    const cols = this.cols;
    // Padding the loop with a screen of blanks lets text enter from the right edge.
    const tape = " ".repeat(cols) + msg;
    const frames = [];
    for (let i = 0; i < tape.length; i++) frames.push((tape + tape).slice(i, i + cols));
    return h_flex().id("root").size_full().overflow_hidden().items_center().px(8).bg(t.chrome)
      .border_t(1).border_color(t.border)
      .on_size_change((size, cx) => {
        const cols = Math.max(8, Math.floor((size.width - 16) / (8 / zoom)));
        if (cols !== this.cols) { this.cols = cols; cx.notify(); }
      })
      // 16 physical px keeps the bitmap font crisp at any zoom.
      .child(div().font_family(FONT).text_size(16 / zoom).text_color(t.accent).whitespace_nowrap()
        .frames(frames, STEP_MS));
  }
}
