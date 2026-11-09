## This repo

My Herdr app config: layout `layouts/herdr_vim.json`, keys in `keys.json`. Herdr's mod API is `AGENTS.md`, which Herdr writes into the live folder (`~/.config/herdr-app`) on every start. Words: `GLOSSARY.md`. Decisions not to undo: `docs/adr/`.

Mods, glossary term → folder under `mods/`:

- Bufferline (and the tab row) → `bufferline`
- Explorer, Changes view → `explorer`
- Links pane → `links`
- Agents list → `agents-list`
- Skills pane → `skills`
- Pane header → `pane-header`
- Context menu → `context-menu`
- Sidebar footer → `sidebar-footer`
- Agent finder, Status log → `agent-finder`
- Leader menu, Needs-me queue, Jumplist, Zen mode → `leader`

Edit only git-tracked files. Shipped mods (gitignored in `.gitignore`) stay as Herdr ships them; to change one, clone it under a name of our own (ADR 0002).

Shared code lives once in `lib/`. `scripts/sync-lib` copies it into the mods listed in `lib/uses.json` (ADR 0001). Edit `lib/`, then run `scripts/sync-lib`; the copies in `mods/` are generated.

Check command: `scripts/check`. It runs `herdr-app check` on every tracked mod, `scripts/sync-lib --check`, JSON parsing, and the behaviour checks in `checks/` (run against the fake Herdr in `checks/fake-herdr.cjs`). Done means it prints `check: all passed`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for havhje/herdr-app-config (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
