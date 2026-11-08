# Shared code is copied from lib/ into each mod

Herdr only loads a mod's imports from inside that mod's own folder: `import "../lib/x.js"` and a symlinked `./x.js` both fail `herdr-app check` with "resolves outside the application directory" (probed 2026-11-08). So shared code lives once in `lib/`, and `scripts/sync-lib` copies each file into the mods `lib/uses.json` lists it for, with a "Generated from lib/<file>… Edit lib/, not this copy." header. `scripts/sync-lib --check` (part of `scripts/check`) fails when a copy drifts.
