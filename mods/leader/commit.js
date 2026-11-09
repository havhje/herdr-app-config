// <leader>gc: the changes committed with a message an agent writes from the diff, then pushed if the repo has a remote.
// The agent on the pane the leader was opened from does it (it knows why the changes were made; a working agent gets
// the message queued). No agent there: a short-lived headless one runs in the pane's folder and a toast says how it went.
// Issue #16.

import { panes, spaces, exec, hc, notify } from "herdr";
import { agentAt } from "./jump.js";

// The headless agent, and all it may run without asking: git.
const HEADLESS = ["claude", "-p"];
const GIT_TOOLS = ["status", "diff", "log", "show", "add", "commit", "push", "remote", "branch", "rev-parse"].map((c) => `Bash(git ${c}:*)`);
const HEADLESS_TIMEOUT = 300000;

const say = (title) => notify({ title, level: "info", timeout: 2000 });
const failed = (title, r) => notify({ title, body: `${r.stderr ?? ""}\n${r.stdout ?? ""}`.trim().split("\n").slice(-4).join("\n"), level: "error" });

// What the agent is asked. Staged changes are the person's own pick, so only those go in; nothing staged means everything.
export function task({ staged, remote }) {
  return [
    staged ? "Commit the staged changes: only what is staged, stage nothing else." : "Stage and commit all changes in this repo.",
    "Write the commit message from the diff, following this repo's commit rules.",
    remote ? "Then push (set the upstream if the branch has none)." : "Do not push: this repo has no remote.",
  ].join(" ");
}

export async function commit(open) {
  const p = panes().find((x) => x.pane === open?.pane);
  const space = spaces().find((s) => (p ? s.id === p.space : s.active));
  const cwd = p?.cwd ?? space?.folder, on = space?.machine ?? null;
  if (!cwd) return say("No folder to commit in");
  const fail = (e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) });
  const git = (...args) => exec("git", args, { cwd, on }).catch(fail);

  const status = await git("status", "--porcelain");
  if (status.code !== 0) return say("Not a git repo");
  if (!status.stdout.trim()) return say("Nothing to commit");
  const staged = (await git("diff", "--cached", "--quiet")).code === 1;
  const remote = Boolean((await git("remote")).stdout.trim());
  const text = task({ staged, remote });

  const agent = agentAt(open);
  if (agent) {
    const r = await hc(["send", agent, text]).catch(fail);
    if (r.code !== 0) failed("Could not ask the agent to commit", r);
    return;
  }

  notify({ title: "Committing…", body: cwd, level: "info", timeout: 3000 });
  const head = async () => (await git("rev-parse", "HEAD")).stdout.trim();
  const before = await head();
  const r = await exec(HEADLESS[0], [...HEADLESS.slice(1), `${text} Answer with the commit's first line only.`, "--allowedTools", ...GIT_TOOLS], { cwd, on, timeout: HEADLESS_TIMEOUT }).catch(fail);
  const after = await head();
  if (!after || after === before) return failed("Nothing was committed", r);
  const subject = (await git("log", "-1", "--format=%s")).stdout.trim();
  // Pushed: nothing on this branch that its upstream lacks.
  const ahead = remote ? await git("rev-list", "--count", "@{u}..HEAD") : null;
  const pushed = ahead?.code === 0 && ahead.stdout.trim() === "0";
  notify({ title: subject, body: !remote ? "Committed" : pushed ? "Committed and pushed" : "Committed, not pushed", level: remote && !pushed ? "warning" : "success", timeout: 6000 });
}
