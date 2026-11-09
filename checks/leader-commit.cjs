// <leader>gc (leader/commit.js): the changes committed by an agent that writes the message itself. The agent on the pane
// the leader was opened from is asked through `hc send`; with no agent there a headless `claude -p` runs in the pane's
// folder. Staged changes only when something is staged; pushed only when the repo has a remote. Issue #16.
const assert = require("node:assert/strict");
const { fakeHerdr, noSpawnErrors, MODS, find, fire } = require("./fake-herdr.cjs");

const ok = (name) => console.log(`  ok  ${name}`);

// A buffer with one pane (an agent when `status` is given), the leader opened from it, and git as `repo` says:
// { repo: false } no repo; changes: `git status --porcelain`; staged; remote; commits: the headless agent commits;
// pushes: it pushes too.
async function press(repo, pane = {}) {
  const h = fakeHerdr();
  h.addSpace({ id: "s1", name: "alpha", tabs: [{ id: "b1" }] });
  h.addPane({ pane: "p1", tab: "b1", terminal: "t1", cwd: "/work/alpha", ...pane });
  h.focusPane("p1");
  h.bar = h.load(MODS.bufferline);
  h.leader = h.load(MODS.leader);
  let head = "aaa";
  h.world.exec = (cmd, args) => {
    const out = (stdout, code = 0) => ({ code, stdout, stderr: "" });
    const a = args.join(" ");
    if (cmd === "hc") return repo.sendFails ? { code: 1, stdout: "", stderr: "t1 is blocked" } : out("");
    if (cmd === "claude") { if (repo.commits) head = "bbb"; return out("Add the thing\n"); }
    if (cmd !== "git") return out("", 1);
    if (repo.repo === false) return { code: 128, stdout: "", stderr: "fatal: not a git repository" };
    if (a === "status --porcelain") return out(repo.changes ?? "");
    if (a === "diff --cached --quiet") return out("", repo.staged ? 1 : 0);
    if (a === "remote") return out(repo.remote ? "origin\n" : "");
    if (a === "rev-parse HEAD") return out(`${head}\n`);
    if (a === "log -1 --format=%s") return out("Add the thing\n");
    if (a === "rev-list --count @{u}..HEAD") return out(repo.pushes ? "0\n" : "1\n");
    throw new Error(`unexpected git ${a}`);
  };
  h.command(MODS.bufferline, "leader");
  await h.settle(); h.flushTimers(); await h.settle();
  h.notes.length = 0;
  for (const key of ["g", "c"]) fire(find(h.leader.render(), "leader"), "on_key_down", { key, key_char: key }, h.cx);
  for (let i = 0; i < 20; i++) await h.settle();
  const ran = (cmd) => h.world.execs.filter(([c]) => c === cmd);
  return { h, sends: ran("hc"), headless: ran("claude"), notes: h.notes.map((n) => `${n.level}: ${n.title}${n.body ? ` / ${n.body}` : ""}`) };
}

(async () => {
  {
    const r = await press({ changes: " M a.txt\n" }, { status: "idle" });
    assert.equal(r.sends.length, 1);
    const [, [verb, to, text]] = r.sends[0];
    assert.deepEqual([verb, to], ["send", "t1"]);
    assert.match(text, /^Stage and commit all changes/);
    assert.match(text, /Do not push/);
    assert.equal(r.headless.length, 0);
    ok("an agent on the pane, nothing staged, no remote: it is asked to commit everything and not push");
  }
  {
    const r = await press({ changes: "M  a.txt\n M b.txt\n", staged: true, remote: true }, { status: "working" });
    const text = r.sends[0][1][2];
    assert.match(text, /^Commit the staged changes: only what is staged/);
    assert.match(text, /Then push/);
    assert.equal(r.headless.length, 0);
    ok("a working agent, something staged, a remote: asked anyway, staged only, then push");
  }
  {
    const r = await press({ changes: " M a.txt\n", sendFails: true }, { status: "blocked" });
    assert.deepEqual(r.notes, ["error: Could not ask the agent to commit / t1 is blocked"]);
    assert.equal(r.headless.length, 0);
    ok("hc send refused (a blocked agent): an error toast with hc's words, no headless agent behind its back");
  }
  {
    const r = await press({ changes: " M a.txt\n", remote: true, commits: true, pushes: true });
    assert.equal(r.sends.length, 0);
    assert.equal(r.headless.length, 1);
    const [, args, opts] = r.headless[0];
    assert.equal(args[0], "-p");
    assert.match(args[1], /^Stage and commit all changes.*Then push/);
    assert.equal(args[2], "--allowedTools");
    assert.ok(args.slice(3).every((t) => /^Bash\(git [a-z-]+:\*\)$/.test(t)), `not only git: ${args.slice(3)}`);
    assert.equal(opts.cwd, "/work/alpha");
    assert.ok(opts.timeout > 30000, "claude needs longer than exec's 30 s");
    assert.deepEqual(r.notes, ["info: Committing… / /work/alpha", "success: Add the thing / Committed and pushed"]);
    ok("no agent on the pane: headless claude in the pane's folder, git only; a toast with the commit's first line");
  }
  {
    const r = await press({ changes: " M a.txt\n", remote: true, commits: true });
    assert.equal(r.notes.at(-1), "warning: Add the thing / Committed, not pushed");
    const local = await press({ changes: " M a.txt\n", commits: true });
    assert.match(local.headless[0][1][1], /Do not push/);
    assert.equal(local.notes.at(-1), "success: Add the thing / Committed");
    ok("headless: a push that did not happen is said; no remote, no push asked");
  }
  {
    const r = await press({ changes: " M a.txt\n" });
    assert.equal(r.notes.at(-1), "error: Nothing was committed / Add the thing");
    ok("headless: HEAD did not move: an error toast with the agent's last words");
  }
  for (const pane of [{ status: "idle" }, {}]) {
    const r = await press({ changes: "" }, pane);
    assert.deepEqual(r.notes, ["info: Nothing to commit"]);
    assert.equal(r.sends.length + r.headless.length, 0);
  }
  ok("nothing to commit: says so, no agent asked or started");
  {
    const r = await press({ repo: false }, { status: "idle" });
    assert.deepEqual(r.notes, ["info: Not a git repo"]);
    assert.equal(r.sends.length + r.headless.length, 0);
    ok("not a git repo: says so");
  }

  noSpawnErrors();
  console.log("leader-commit: all passed");
})().catch((e) => { console.error(e); process.exit(1); });
