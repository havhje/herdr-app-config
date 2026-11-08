# ctrl-space is bound to bufferline.leader, not to the leader mod

`<mod>.<command>` reaches shown mod copies only, and a copy starts the first time it shows (Herdr's `AGENTS.md`). The leader mod is hidden until opened, so a key bound to `leader.<command>` would do nothing. `keys.json` binds ctrl-space to `bufferline.leader` because the bufferline is always shown; it shows the leader, waits 60 ms (Herdr has no "now shown" event), then runs `leader.open`. Everything else stays in the leader: moving the key there looks like a cleanup but breaks the leader key.
