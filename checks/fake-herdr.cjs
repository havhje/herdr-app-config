// A fake Herdr app for checks: the second adapter at the `herdr` seam (the app is the first).
// It loads a mod's own files as the app would, with `herdr`, `gpui-kit` and `gpui-base` played here,
// and renders it to a plain tree a check can read (ids, text, colours, icons, handlers).
//
//   const h = fakeHerdr();
//   h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }] });
//   h.addPane({ pane: "p1", tab: "b1", terminal: "t1", status: "working" });
//   h.focusPane("p1");
//   const tabs = h.load(MODS.bufferline);
//   const tree = tabs.render();
//
// What it plays: spaces/agents/panes/terminals/focused derived from one small world (a space's and a tab's
// status is its most urgent agent's, blocked > done > working > idle, as herdr.d.ts says); shared/setShared;
// run (recorded; pane/agent focus, space.select and layout show/hide/resize/select also change the world, and
// `<mod>.<command>` reaches that mod's shown copies' nextCommand); notify/openOverlay (recorded); the shown layout;
// exec and hc (recorded in world.execs, answered by world.exec; hc as cmd "hc");
// a theme whose every colour reads as its own name ("#working"); timers you flush by hand.
// It knows nothing of any one mod: mod folders are named once, in MODS below.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
// The mods and layout the checks are about. #13 renames these: change them here only.
const MODS = { bufferline: "bufferline", explorer: "explorer", links: "links", paneHeader: "pane-header", agentsList: "agents-list", agentFinder: "agent-finder", leader: "leader" };
const LAYOUT = "layouts/herdr_vim.json";

// ---- gpui: every builder call is recorded on a node ----

const NODE = Symbol("node");
// Builders that take a style function (`.hover(s => s.bg(x))`): kept as the style they set.
const SUB_STYLES = new Set(["hover", "active", "focus", "focus_visible", "group_hover"]);

function element(kind = "div", source) {
  const node = { kind, source, id: undefined, items: [], on: {}, style: {}, styles: {}, content: undefined };
  const proxy = new Proxy(node, {
    get(_t, key) {
      if (key === NODE) return node;
      if (typeof key === "symbol" || key === "then" || key === "toJSON") return undefined;
      return (...args) => {
        if (key === "when") { if (args[0]) args[1](proxy); }
        else if (key === "when_some") { if (args[0] != null) args[1](proxy, args[0]); }
        else if (key === "child") node.items.push(args[0]);
        else if (key === "children") node.items.push(...args[0]);
        else if (key === "id") node.id = args[0];
        else if (key === "content") node.content = args[0];
        else if (key === "on_mouse_down" || key === "on_mouse_up") node.on[`${key}:${args[0]}`] = args[1];
        else if (key.startsWith("on_")) node.on[key] = args[0];
        else if (SUB_STYLES.has(key) && typeof args[0] === "function") { const s = element(); args[0](s); node.styles[key] = s[NODE].style; }
        else node.style[key] = args.length === 0 ? true : args.length === 1 ? args[0] : args;
        return proxy;
      };
    },
  });
  return proxy;
}

// A rendered tree as plain data: { kind, source, id, style, styles, on, items, content }; text stays as strings.
function snapshot(x) {
  if (x == null || x === false) return null;
  if (typeof x !== "object" && typeof x !== "function") return String(x);
  const n = x[NODE];
  if (!n) return x;
  return { ...n, items: n.items.map(snapshot).filter((c) => c != null), content: n.content === undefined ? undefined : snapshot(n.content) };
}

const gpuiKit = {
  View: class View {},
  div: () => element("div"),
  svg: (source) => element("svg", source),
  image: (source) => element("image", source),
};
const gpuiBase = {
  h_flex: () => element("h"),
  v_flex: () => element("v"),
  Popup: { new: (id, trigger) => element("popup").id(id).child(trigger) },
  HoverCard: { new: (id) => element("hovercard").id(id) },
  Button: { new: (id) => element("button").id(id) },
  Input: { new: () => element("input") },
  InputState: { new: () => ({ on() {}, value: () => "", set_value() {}, focus() {} }) },
  Scrollbar: { new: () => element("scrollbar"), vertical: () => element("scrollbar") },
  Editor: { new: () => element("editor") },
  EditorState: { new: () => ({ release() {} }) },
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) },
  // Draws every row: a check sees the whole list.
  v_virtual_list: (id, count, _h, _key, rows) => element("list").id(id).children(rows({ start: 0, end: count })),
};

// ---- reading a rendered tree ----

function walk(node) {
  return node && typeof node === "object" ? [node, ...node.items.flatMap(walk)] : [];
}
function find(node, id) {
  return walk(node).find((n) => n.id === id) ?? null;
}
function strings(node) {
  if (typeof node === "string") return [node];
  return node && typeof node === "object" ? node.items.flatMap(strings) : [];
}
function fire(node, event, ...args) {
  if (!node) throw new Error(`no node to fire ${event} on`);
  if (typeof node.on[event] !== "function") throw new Error(`node ${node.id ?? node.kind} has no ${event}`);
  return node.on[event](...args);
}
// A status mark as a word and its colour: "spinner #working", "! #blocked", "✓ #done", "dot #done", "ring #idle".
const GLYPHS = ["●", "!", "✓"];
function markOf(n) {
  if (!n || typeof n !== "object") return null;
  if (n.kind === "svg" && /spinner/.test(n.source)) return `spinner ${n.style.text_color}`;
  if (n.items.length === 1 && GLYPHS.includes(n.items[0])) return `${n.items[0]} ${n.style.text_color}`;
  if (n.style.rounded_full && n.style.border_color) return `ring ${n.style.border_color}`;
  if (n.style.rounded_full && n.style.bg) return `dot ${n.style.bg}`;
  return null;
}
// Every status mark under a node, in order; "none" when there is none.
function marks(node) {
  const all = walk(node).map(markOf).filter(Boolean);
  return all.length ? all.join(" + ") : "none";
}

// ---- the world and its herdr module ----

const PROGRAMS = {
  claude: { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: true, tile: null, color: null, shell: false, agent: true },
  shell: { key: "shell", name: "zsh", icon: "icons/terminal.svg", tint: true, tile: null, color: null, shell: true, agent: false },
};
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const urgent = (words) => words.filter((w) => RANK[w]).sort((a, b) => RANK[b] - RANK[a])[0] ?? null;
const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
// Mods run in their own vm context: a plain copy compares with this one's objects.
const plain = copy;
// Errors from every fake's spawned tasks (a mod's command loop that threw).
const spawnErrors = [];
function noSpawnErrors() { if (spawnErrors.length) throw spawnErrors[0]; }

function fakeHerdr(opts = {}) {
  const world = {
    spaces: [], // { id, name, named, folder, machine, tabs: [{ id, name, named, changed_at, settled }] }
    panes: [], // { pane, tab, terminal, mod, cwd, title, zoomed }
    terminals: [], // { address, status, program, parent, state, labels, turn, name, cwd, title }
    focused: null, // { space, tab, pane }
    activeTab: {}, // space -> tab it shows
    shared: {},
    execs: [], // [cmd, args, opts] for every exec a mod ran
    exec: null, // (cmd, args, opts) => { code, stdout, stderr }, set by a check
    layout: JSON.parse(fs.readFileSync(path.join(ROOT, opts.layout ?? LAYOUT), "utf8")),
    settings: { font: "JetBrains Mono", zoom: 1 },
  };
  const calls = [], notes = [], overlays = [], errors = [], loaded = [];
  const timers = [];
  let handleFocused = null;

  const tabOf = (id) => world.spaces.flatMap((s) => s.tabs.map((c) => ({ s, c }))).find((x) => x.c.id === id);
  const termOf = (address) => world.terminals.find((k) => k.address === address);
  // An agent: a pane whose terminal reports a status. Its word as agents() gives it (error is the terminal's own).
  const agentWord = (k) => (k?.status == null ? null : k.status === "error" ? "idle" : k.status);

  const herdr = {
    spaces: () => world.spaces.map((s, i) => {
      const shownTab = world.activeTab[s.id] ?? s.tabs[0]?.id;
      const tabs = s.tabs.map((c, j) => ({
        id: c.id, index: j + 1, name: c.name ?? String(j + 1), named: Boolean(c.name), active: c.id === shownTab,
        status: urgent(world.panes.filter((p) => p.tab === c.id).map((p) => agentWord(termOf(p.terminal)))),
        panes: world.panes.filter((p) => p.tab === c.id).length, zoomed: false, settled: Boolean(c.settled), settled_at: null,
        changed_at: c.changed_at ?? null, working_since: null,
      }));
      return { id: s.id, index: i + 1, name: s.name, named: true, folder: s.folder ?? `/work/${s.name}`, machine: null, branch: null,
        active: world.focused?.space === s.id, status: urgent(tabs.map((c) => c.status)), tabs };
    }),
    panes: () => world.panes.map((p) => {
      const k = termOf(p.terminal), t = tabOf(p.tab);
      return { pane: p.pane, terminal: p.terminal ?? null, ...(p.mod ? { mod: p.mod } : {}), tab: p.tab, space: t?.s.id,
        title: k?.title ?? p.title ?? "", cwd: k?.cwd ?? p.cwd ?? null, branch: null, status: agentWord(k), app: k?.status != null ? k.program.key : null,
        program: copy(k?.program ?? PROGRAMS.shell), focused: world.focused?.pane === p.pane, zoomed: Boolean(p.zoomed), movable: true };
    }),
    agents: () => herdr.panes().filter((p) => p.status != null).map((p, seq) => {
      const t = tabOf(p.tab), k = termOf(p.terminal);
      return { address: p.terminal, pane: p.pane, space: t.s.id, space_name: t.s.name, tab: p.tab, tab_index: t.s.tabs.indexOf(t.c) + 1,
        tab_name: t.c.name ?? String(t.s.tabs.indexOf(t.c) + 1), status: p.status, app: p.app, program: p.program, title: k.title ?? "",
        seq, pinned: false, focused: p.focused };
    }),
    terminals: () => world.terminals.map((k) => ({ state: "live", labels: {}, ...copy(k) })),
    focused: () => {
      const f = world.focused;
      if (!f) return null;
      const p = world.panes.find((x) => x.pane === f.pane), k = termOf(p?.terminal);
      return { space: f.space, tab: f.tab, pane: f.pane, terminal: p?.terminal ?? null, shown: null, agent: k?.status != null ? k.address : null, cwd: k?.cwd ?? null };
    },
    layout: () => copy(world.layout),
    theme: () => new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `#${k}` : undefined) }),
    settings: () => copy(world.settings),
    shared: (key) => copy(world.shared[key]),
    setShared: (key, value) => { world.shared[key] = copy(value); return null; },
    run: (name, args) => { calls.push([name, copy(args ?? {})]); act(name, args ?? {}); return null; },
    notify: (n) => { notes.push(copy(n)); return null; },
    openOverlay: (spec) => { overlays.push(copy(spec)); return `overlay-${overlays.length}`; },
    closeOverlay: () => null,
    setAgentOrder: () => null,
    // A check answers programs with world.exec(cmd, args, opts); every call is in world.execs.
    exec: async (cmd, args, opts) => { world.execs.push([cmd, copy(args), copy(opts ?? {})]); return world.exec?.(cmd, args, opts) ?? { code: 1, stdout: "", stderr: "" }; },
    hc: async (args) => { world.execs.push(["hc", copy(args), {}]); return world.exec?.("hc", args, {}) ?? { code: 1, stdout: "", stderr: "" }; },
    readTextFile: async () => null,
    watchFolder: () => new Promise(() => {}),
    home: () => "/home/me",
    appHome: () => ROOT,
    keys: () => [],
    machines: () => [{ name: null, layout: "ready" }],
    window: () => ({ platform: "linux", buttons: true }),
    updates: () => ({ app: {} }),
    playSound: () => null,
  };

  // What the app does on the commands the checked mods send.
  function act(name, args) {
    const [mod, cmd] = name.split(".");
    const node = (id) => findLayout(world.layout, id);
    if (name === "pane.focus") {
      const p = args.pane ? world.panes.find((x) => x.pane === args.pane) : world.panes.find((x) => x.terminal === args.terminal);
      if (p) focusPane(p.pane);
    } else if (name === "agent.focus") {
      const p = world.panes.find((x) => x.terminal === args.terminal);
      if (p) focusPane(p.pane);
    } else if (name === "space.select") {
      const s = args.id ? world.spaces.find((x) => x.id === args.id) : world.spaces[args.index - 1];
      const tab = s && (world.activeTab[s.id] ?? s.tabs[0]?.id), p = world.panes.find((x) => x.tab === tab);
      if (p) focusPane(p.pane);
    } else if (name === "layout.show" || name === "layout.hide") {
      const n = node(args.id);
      if (n) n.hidden = name === "layout.hide";
    } else if (name === "layout.resize") {
      const n = node(args.id);
      if (n) n.size = args.px != null ? { px: args.px } : { weight: args.weight };
    } else if (name === "layout.select") {
      const n = node(args.stack);
      if (n) n.active = args.child;
    } else deliver(mod, cmd);
  }

  // `<mod>.<command>` reaches shown copies only (AGENTS.md). A copy sits in the layout block naming its mod and props;
  // it is shown when nothing above it is hidden (a 0 px node still counts as shown). A copy with no block (a pane
  // header, a mod loaded on its own) always gets it.
  function blocksOf(n, h, up = []) {
    const here = [...up, n];
    const mine = n.content?.mod === h.name && JSON.stringify(n.content.props ?? {}) === JSON.stringify(h.props) ? [here] : [];
    return [...mine, ...(n.children ?? []).flatMap((c) => blocksOf(c, h, here))];
  }
  function shown(h) {
    const at = blocksOf(world.layout, h);
    return !at.length || at.some((path) => path.every((n) => !n.hidden));
  }
  function deliver(mod, cmd) { for (const m of loaded) if (m.name === mod && shown(m)) m.command(cmd); }

  // Looking at a done agent makes it idle (herdr.d.ts, AgentInfo.status).
  function focusPane(pane) {
    const p = world.panes.find((x) => x.pane === pane);
    if (!p) throw new Error(`no pane ${pane}`);
    const t = tabOf(p.tab);
    world.focused = { space: t.s.id, tab: p.tab, pane };
    world.activeTab[t.s.id] = p.tab;
    const k = termOf(p.terminal);
    if (k?.status === "done") k.status = "idle";
  }

  const cx = {
    notify() {},
    stop_propagation() {},
    spawn(fn) { Promise.resolve().then(() => fn(cx)).catch((e) => { errors.push(e); spawnErrors.push(e); }); },
    bind_keys() {},
    timer: {
      every(ms, fn) { const t = { ms, fn, every: true, cancel() { t.gone = true; } }; timers.push(t); return t; },
      after(ms, fn) { const t = { ms, fn, every: false, cancel() { t.gone = true; } }; timers.push(t); return t; },
    },
    focus_handle() {
      const h = { focus() { handleFocused = h; }, is_focused: () => handleFocused === h, release() { return true; } };
      return h;
    },
  };

  // Loads mods/<name> as the app would: its main.js and what it imports from its own folder, in its own context.
  // storage: a copy's localStorage; pass an earlier copy's (handle.storage) to load it as after a restart.
  function load(name, props = {}, storage = new Map()) {
    const dir = path.join(ROOT, "mods", name);
    const queue = [], waiting = [];
    const mine = {
      ...herdr,
      props: () => copy(props),
      nextCommand: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiting.push(r))),
    };
    const context = vm.createContext({
      console,
      localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
      window: { mouse_position: () => null, viewport_size: () => ({ width: 1600, height: 1000 }) },
    });
    const outside = {
      herdr: mine, "gpui-kit": gpuiKit, "gpui-base": gpuiBase,
      buffer: require("node:buffer"), crypto: require("node:crypto"),
      // Reads and writes nothing: a check never touches the disk through a mod.
      "fs/promises": { exists: async () => false, mkdir: async () => {}, writeFile: async () => {}, readFile: async () => { throw new Error("fake fs"); }, readdir: async () => [] },
    };
    const cache = new Map();
    const importFrom = (file) => (spec) => {
      if (!spec.startsWith("./")) {
        if (!(spec in outside)) throw new Error(`${name}: unknown import "${spec}"`);
        return outside[spec];
      }
      const at = path.join(path.dirname(file), spec);
      if (!at.startsWith(dir + path.sep)) throw new Error(`${name}: imports outside its folder: ${spec}`);
      if (!cache.has(at)) {
        const exports = {};
        cache.set(at, exports);
        const run = vm.runInContext(asFunction(fs.readFileSync(at, "utf8")), context, { filename: at });
        Object.assign(exports, run(importFrom(at)));
      }
      return cache.get(at);
    };
    const Mod = importFrom(path.join(dir, "main.js"))("./main.js").default;
    if (typeof Mod !== "function") throw new Error(`${name}: main.js has no default export class`);
    const view = new Mod();
    view.init?.(props, cx);
    const handle = {
      name, view, props, storage,
      render: () => snapshot(view.render(cx)),
      command(c) { if (waiting.length) waiting.shift()(c); else queue.push(c); },
    };
    loaded.push(handle);
    return handle;
  }

  return {
    world, calls, notes, overlays, errors, cx, herdr, load,
    // The world, in the shapes herdr.d.ts gives. A pane with `status` gets an agent terminal.
    addSpace({ id, name = id, tabs = [], folder }) {
      world.spaces.push({ id, name, folder, tabs: tabs.map((c) => ({ ...c })) });
    },
    addPane({ pane, tab, terminal = `term-${pane}`, status = null, program, title, cwd, mod }) {
      world.panes.push({ pane, tab, terminal: mod ? null : terminal, mod, title });
      if (!mod) world.terminals.push({ address: terminal, status, program: program ?? (status != null ? PROGRAMS.claude : PROGRAMS.shell), title: title ?? "", cwd: cwd ?? `/work/${pane}` });
    },
    // A sub-agent: a terminal another started, with no pane of its own.
    addSubAgent({ address, parent, status, name }) {
      world.terminals.push({ address, parent, status, name: name ?? address, program: PROGRAMS.claude });
    },
    removePane(pane) {
      const p = world.panes.find((x) => x.pane === pane);
      world.panes = world.panes.filter((x) => x !== p);
      world.terminals = world.terminals.filter((k) => k.address !== p.terminal);
    },
    setStatus(address, status) { termOf(address).status = status; },
    terminal: termOf,
    focusPane,
    // A key command for a mod (keys.json "<mod>.<command>"), to every shown copy, as the app does.
    command: deliver,
    // Lets spawned tasks and command loops run.
    settle: () => new Promise((r) => setImmediate(r)),
    // Runs every pending `after` timer once (and any it adds).
    flushTimers() {
      for (let i = 0; i < 100; i++) {
        const t = timers.find((x) => !x.every && !x.gone);
        if (!t) return;
        t.gone = true;
        t.fn(cx);
      }
    },
    takeCalls() { return calls.splice(0); },
    shared: (key) => copy(world.shared[key]),
    setShared: herdr.setShared,
  };
}

function findLayout(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = findLayout(c, id); if (f) return f; }
  return null;
}

// One mod file as a function of its imports: `import { a } from "x"` reads from the importer, exports are returned.
// The checked mods use only named imports, `import * as`, `export function|const|let|class` and `export default class`.
function asFunction(src) {
  const names = [];
  let def = null;
  const body = src
    .replace(/^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";?/gm, (_, list, from) => `const {${list.replace(/\s+as\s+/g, ": ")}} = __import(${JSON.stringify(from)});`)
    .replace(/^import\s*\*\s*as\s+(\w+)\s+from\s*"([^"]+)";?/gm, (_, n, from) => `const ${n} = __import(${JSON.stringify(from)});`)
    .replace(/^export\s+default\s+class\s+(\w+)/m, (_, n) => { def = n; return `class ${n}`; })
    .replace(/^export\s+default\s+class\b/m, () => { def = "__default"; return "const __default = class"; })
    .replace(/^export\s+(async\s+function\*?|function\*?|const|let|class)\s+(\w+)/gm, (_, kw, n) => { names.push(n); return `${kw} ${n}`; });
  if (/^\s*(import|export)\b/m.test(body)) throw new Error(`an import or export the fake can't read: ${/^\s*(import|export)\b.*$/m.exec(body)[0]}`);
  const out = [...names, ...(def ? [`default: ${def}`] : [])].join(", ");
  return `(function (__import) {${body}\nreturn { ${out} };\n})`;
}

module.exports = { fakeHerdr, noSpawnErrors, MODS, LAYOUT, walk, find, strings, fire, markOf, marks, plain };
