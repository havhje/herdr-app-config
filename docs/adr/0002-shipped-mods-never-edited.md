# Shipped mods are never edited; ours are clones with our own names

Herdr replaces its shipped mods, layouts and themes whole on every start, so an edit to one is lost silently. We clone a shipped mod into a folder with our own name (e.g. `context-menu` from Herdr's `menu`) and change the clone; the shipped folders are listed in `.gitignore` and never tracked. Same for layouts and themes: our layout is `herdr_vim`, our theme `omarchy`.
