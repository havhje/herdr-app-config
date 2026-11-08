// Agents in grouped or priority views; a parent reads with its sub-agents (agent-status.js).
// A viewed done agent stays in Done until left.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, spaces, focused, theme, shared, setShared, setAgentOrder, nextCommand, run } from "herdr";
import { statusReader, urgency, label } from "./agent-status.js";
import { stopsInit, stopsEnd, focusRoot, enter, onStop } from "./focus.js";
import { focusAgent } from "./zoom.js";
import { planMotion, flying, leavingRows } from "./motion.js";
import { agentEntries, STACK } from "./rows.js";
// <leader>ag flips shared "agents.sort" between these.
const SORTS = [{ id: "priority" }, { id: "grouped" }];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];

export default class AgentsList extends View {
  async close() { stopsEnd(this); }

  init(_props, cx) {
    stopsInit(this, cx);
    // pane.go onto this list (mod.json's "focusable"): the keyboard starts at the heading's button.
    cx.spawn(async (cx) => {
      // nvim feel: it lands on the agent you're viewing (else the first), and j/k walk the agents (navKey).
      for (;;) if (await nextCommand() === "focus") {
        const ids = this.navIds ?? [], viewed = `ag-${shared("agents-list.rows")?.view ?? focused()?.agent}`;
        this.fs.last = null;
        enter(this, cx, ids.includes(viewed) ? viewed : ids[0]);
      }
    });
    this.folded = JSON.parse(localStorage.getItem("folded") ?? "{}");
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    cx.timer.every(1000, () => this.compute());
    cx.timer.every(30000, (cx) => cx.notify()); // The rows' times move with nothing else changing.
    // Older installs kept pins in this list's storage; move them over once, before anything writes any.
    if (shared("agents.pins") == null && localStorage.getItem("pins")) setShared("agents.pins", JSON.parse(localStorage.getItem("pins")));
  }

  // Shared with the leader (<leader>ap pins): one set of pins.
  get pins() {
    return shared("agents.pins") ?? [];
  }

  isFolded(id, initial = true) {
    return this.folded[id] ?? initial;
  }

  toggleFold(id, cx, initial = true) {
    this.folded[id] = !this.isFolded(id, initial);
    localStorage.setItem("folded", JSON.stringify(this.folded));
    cx.notify();
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    // As the tab has it: when its state last changed, not when this list first saw it.
    const changedAt = new Map(spaces().flatMap((s) => s.tabs ?? []).map((c) => [c.id, c.changed_at]));
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: changedAt.get(a.tab) ?? now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Drops pins and fold choices of agents that ended. Only for machines the list has heard from:
  // right after a start, or while a machine connects, its agents aren't listed yet.
  prune(all) {
    const machine = (addr) => (addr.includes("/") ? addr.split("/")[0] : "");
    const heard = new Set(all.map((k) => machine(k.address)));
    const live = new Set(all.filter((k) => k.state === "live").map((k) => k.address));
    const kept = this.pins.filter((p) => !heard.has(machine(p)) || live.has(p));
    if (kept.length !== this.pins.length) setShared("agents.pins", kept);
    // Group headers (sp-…, sec-…, pinned) fold under the same store; only agents' entries end.
    const ended = Object.keys(this.folded).filter((k) => !/^(sp-|sec-|pinned$)/.test(k) && heard.has(machine(k)) && !live.has(k));
    for (const k of ended) delete this.folded[k];
    if (ended.length) localStorage.setItem("folded", JSON.stringify(this.folded));
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, word: cur.status } : null;
  }

  word(a) {
    const sawDone = a.address === this.held?.address && this.held.word === "done" && a.status === "idle";
    return sawDone ? "done" : a.status;
  }

  compute() {
    const sort = sortOf();
    // Every agent's status, sub-agents in (agent-status.js).
    const status = statusReader();
    // <leader>ai hides idle agents (shared "agents.hideIdle"); the one you're on and pinned ones stay.
    let list = agents();
    if (shared("agents.hideIdle")) list = list.filter((a) => status.agent(a.address) !== "idle" || a.focused || this.pins.includes(a.address));
    this.listed = new Set(list.map((a) => a.address));
    const all = terminals();
    // A mod pane has no agent of its own, and Herdr's is then the chosen one, else the first of all: it counts only in that tab, as in the inbox.
    const f = focused();
    const shown = f?.pane && !f.terminal && !list.some((a) => a.tab === f.tab && a.address === f.agent) ? null : f?.agent;
    const ps = panes();
    const now = Date.now();
    // A sub-agent folded away from view lights its nearest listed ancestor.
    const ancestor = (() => {
      const byAddress = new Map(all.map((k) => [k.address, k])), seen = new Set();
      let k = byAddress.get(shown);
      while (k && !this.listed.has(k.address) && !seen.has(k.address)) { seen.add(k.address); k = byAddress.get(k.parent); }
      return k && this.listed.has(k.address) ? k.address : null;
    })();
    const viewing = (a) => a.focused || (a.address === ancestor && this.isFolded(a.address));
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    // As shown: its agent status. Sorted, a viewed done agent keeps Done until left.
    const shownStatus = (a) => status.agent(a.address);
    const sorted = new Map(list.map((a) => [a.address, status.agent(a.address, this.word(a)) ?? "idle"]));
    const rankOf = (a) => urgency(sorted.get(a.address));
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    this.prune(all);
    const pinned = this.pins.map((p) => list.find((a) => a.address === p)).filter(Boolean);
    const rest = list.filter((a) => !this.pins.includes(a.address));
    list = [...pinned, ...rest];
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const id = byPriority ? `sec-${rankOf(a)}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? label(sorted.get(a.address)) : a.space_name || "", buffer: byPriority ? null : a.space, members: [a] });
    }
    // Every top-level agent, in its group or not. A sub-agent with no pane can only open as a peek, a popup over the work. A folded group
    // counts: Idle folds by default, and leaving a row there would take it off the walk, with no key back.
    const order = [...new Set(groups.flatMap(g => g.members.map(a => a.address)))];
    const view = order.includes(ancestor) ? ancestor : null;
    // The agent in view, read back when the list takes the keyboard (nextCommand "focus").
    const drawn = { order, view };
    if (JSON.stringify(drawn) !== JSON.stringify(shared("agents-list.rows") ?? null)) setShared("agents-list.rows", drawn);
    const addresses = list.map(a => a.address), key = JSON.stringify(addresses);
    if (key !== this.agentOrder) {
      this.agentOrder = key;
      setAgentOrder(addresses);
    }
    return { sort, list, all, shown, ps, now, viewing, byPriority, status, shownStatus, pinned, groups };
  }

  // nvim keys on the list: j/k (and arrows) move between agents, gg/G ends, l/enter/right go to the agent's
  // buffer, tab and pane with the keyboard, h/esc back to the terminals on the left.
  navKey(e, cx) {
    const k = e.keystroke, id = onStop(this), ids = this.navIds ?? [];
    if (!id) return;
    const i = ids.indexOf(id), go = (n) => {
      const to = ids[Math.max(0, Math.min(ids.length - 1, n))], h = to && this.fs.handles.get(to);
      if (h) { h.focus(); cx.notify(); }
    };
    const g = this.g; this.g = 0;
    if (k === "j" || k === "down") go(i < 0 ? 0 : i + 1);
    else if (k === "k" || k === "up") go(i < 0 ? 0 : i - 1);
    else if (k === "shift-g" || e.key_char === "G") go(ids.length - 1);
    else if (k === "g") { if (g && Date.now() - g < 600) go(0); else this.g = Date.now(); }
    else if ((k === "l" || k === "right" || k === "enter") && id.startsWith("ag-")) { focusAgent(id.slice(3)); run("pane.focus", { terminal: id.slice(3) }); }
    else if (k === "h" || k === "left" || k === "escape") run("pane.go", { direction: "left" });
    else return;
    cx.stop_propagation();
  }

  render(cx) {
    const t = theme();
    const data = this.compute();
    const { sort, list } = data;
    const entries = agentEntries(this, t, data);

    // The list's motion (motion.js). Folds and the sort play it too.
    planMotion(this, entries, cx);
    // A row no longer drawn has no hover listener, so it never reports the pointer leaving it: forget it, or it comes back lit.
    const gone = this.hovered;
    if (gone && !entries.some((e) => e.key === gone)) this.hovered = this.hot = null;
    const rows = entries.map((e) => flying(this, e.key, e.el));
    this.navIds = entries.filter((e) => !e.key.startsWith("sub-") && !e.key.startsWith("m:")).map((e) => `ag-${e.key}`);

    return focusRoot(this, v_flex()
      .id("agents-list-root")
      .on_key_down((e, cx) => this.navKey(e, cx))
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(14)
      .child(
          h_flex()
            .id("agents-heading")
            .pl(18).pr(8)
            .h(31)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(12).font_medium().text_color(t.muted).child(shared("agents.hideIdle") ? "Agents · idle hidden" : "Agents"))
      )
      .when(list.length === 0, (el) =>
        el.child(div().px(16).py(24).text_center().text_size(12).line_height("16px").text_color(t.dim).child(shared("agents.hideIdle") ? "No busy agents. Idle ones are hidden (leader a i)." : "No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(8).pb(8).overflow_y_scroll()
        // The rows in one box that scrolls, so the leaving ones placed in it scroll with them.
        .child(v_flex().id("ag-content").relative().w_full().flex_none().gap(STACK).children(leavingRows(this)).children(rows))));
  }
}
