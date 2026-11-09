// What an agent's row says besides its status, one rule for the agents list and the agent finder:
// its program's icon, and how long it has been in its state.
import { image, svg } from "gpui-kit";
import { shared } from "herdr";

// The agent's icon from the app's program table: a one-color glyph or a picture.
export function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// How long it's been in its state, as the shipped agents list says it.
export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The state a time is kept for. Done and idle count as one: looking at a finished agent turns done into idle,
// and looking isn't the agent doing anything.
export const stateOf = (a) => (a.status === "done" ? "idle" : a.status);

// When each agent entered its state (ms), for mods other than the agents list. The list is the only writer: it
// stamps the changes and shares them as "agents.changed" ({ address: { s, at } }). Snapshot once per render;
// null for an agent the list hasn't caught up with.
export function sinceReader() {
  const changed = shared("agents.changed") ?? {};
  return (a) => (changed[a.address]?.s === stateOf(a) ? changed[a.address].at : null);
}
