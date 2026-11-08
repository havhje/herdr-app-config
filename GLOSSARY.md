# Herdr app config

My own setup of the Herdr app (a desktop app for terminals and coding agents), tuned to look and behave like my LazyVim setup.

## The app

**Herdr app**:
The desktop window that shows buffers, tabs, panes and agents, redrawn live from this folder's files.
_Avoid_: Herdr (alone), the GUI

**herdr-core**:
The background program that runs every terminal and agent, and keeps them running when the window closes.
_Avoid_: core, hc (that's its command), daemon

**App window**:
The desktop window of the Herdr app as a whole.
_Avoid_: window (alone; in nvim language "window" means a pane)

**Machine**:
A computer that buffers can live on: this one, or another reached over ssh.
_Avoid_: host, server, remote

## What you work in

**Buffer**:
A place to work on one machine, usually one repo, holding one or more tabs; one cell in the bufferline. Herdr's own word for it is *space*.
_Avoid_: workspace, project

**Worktree buffer**:
A buffer whose folder is a linked git worktree of a repo, not the repo's own checkout.
_Avoid_: branch buffer

**Tab**:
A piece of work inside a buffer: its terminals and how they are split.
_Avoid_: page, buffer

**Pane**:
One terminal or mod shown inside a tab, next to its siblings.
_Avoid_: window, split, view

**Agent**:
A terminal whose program reports a status (a coding agent such as Claude Code or pi).
_Avoid_: bot, session, assistant

**Sub-agent**:
An agent started by another agent, belonging to its parent's tab without a pane of its own.
_Avoid_: child agent, worker

**Agent status**:
What an agent says it is doing: working, blocked (needs me), done (finished while I wasn't looking) or idle.
_Avoid_: state, mode

**Pinned agent**:
An agent kept at the top of the agents list regardless of its status.
_Avoid_: favourite, starred

## What makes up the screen

**Layout**:
One whole arrangement and look of the app window; mine is *herdr_vim*.
_Avoid_: theme, view, screen

**Mod**:
A small program that draws one part of the screen (a panel, a header, a menu).
_Avoid_: plugin, extension, widget

**Shipped**:
Owned by Herdr and replaced on every start; never edited in place.
_Avoid_: built-in, stock, default (when meaning ownership)

**Clone**:
My own copy of a shipped layout or mod, which Herdr never updates.
_Avoid_: fork, copy, override

**Bufferline**:
The top bar listing every buffer by number and name, nothing to click.
_Avoid_: tab bar, spaces list

**Sidebar**:
The right-hand column holding the agents list and, when open, the leader menu.
_Avoid_: drawer, rail

**Agents list**:
Every agent in the sidebar, grouped by buffer or by status, pinned agents first.
_Avoid_: inbox, agents panel

**Sidebar footer**:
The strip at the bottom of the sidebar; it shows a restart button once an app update is downloaded.
_Avoid_: status bar

**Pane header**:
The line on top of each pane: what it runs, its title, folder and agent status.
_Avoid_: title bar

**Context menu**:
The right-click menu on a pane, tab or buffer, with Herdr's own items.
_Avoid_: terminal menu

**Side panel**:
The left-hand column showing the explorer, open or closed per buffer.
_Avoid_: sidebar, drawer

**Explorer**:
The file tree in the side panel, driven by nvim keys.
_Avoid_: files panel, file browser, tree

**Changes view**:
The explorer showing only changed files and their folders, each with lines added and removed; `gs` in the explorer or `<leader>gg` switches to it.
_Avoid_: changes list, diff panel, git panel

**Chrome**:
Clickable buttons and handles drawn around the work; this setup removes it in favour of keys.
_Avoid_: UI, controls, decoration

## How you drive it

**Leader**:
The key that starts every menu sequence: ctrl-space.
_Avoid_: prefix, hotkey

**Leader menu**:
The list of keys that can follow the leader, which narrows as keys are pressed.
_Avoid_: which-key (the nvim plugin it imitates), popup, palette

**Group**:
A set of related leader keys under one letter, such as +buffer, +agents, +git, +ui.
_Avoid_: submenu, category

**Needs-me queue**:
The agents that are blocked or done, blocked first and longest-waiting first; `<leader>¨a` / `<leader>åa` step through it.
_Avoid_: inbox, attention list

**Jumplist**:
The tabs you landed on, in order, with the pane you were last on in each; `<leader>o` goes back, `<leader>i` forward, as nvim's ctrl-o / ctrl-i.
_Avoid_: history, back stack

**Agent finder**:
The dialog that lists every agent to filter and go to, with when it needed me or finished and the selected agent's screen beside it; `<leader><space>`.
_Avoid_: picker (Herdr's tab picker), switcher

**Status log**:
Every time an agent needed me or finished, with the time; `tab` in the agent finder shows it.
_Avoid_: notifications, history

**Zen mode**:
Only the shown pane: sidebar, bufferline, tab row and side panel hidden and the pane zoomed; `<leader>uz` toggles it.
_Avoid_: focus mode, fullscreen

**Command palette**:
Herdr's searchable list of every app command.
_Avoid_: leader menu, launcher

## Working on this setup

**Tune worktree**:
The separate checkout where changes are tried before they reach the main setup.
_Avoid_: sandbox, test copy, branch

**Tune window**:
A second app window running on the tune worktree, used to try changes by hand.
_Avoid_: test window, preview
