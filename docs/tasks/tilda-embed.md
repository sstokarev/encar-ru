+++
branch = "task/tilda-embed"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/tilda-embed"
size = "deep"
size_why = "the embed shape decides how the calculator looks inside someone else's page, and it is measured against a live Tilda block"
owns = ["site/embed.html", "src/page/embed.ts", "test/embed.test.ts", "docs/harness/tilda-embed.md"]
reads = ["site/calc.html", "src/page/main.ts", "src/page/render.ts", "docs/harness/project.md", "docs/harness/pipeline.md"]
accepts = ["operator pastes the embed snippet into a real Tilda page, opens it on a phone and on a desktop, and the calculator works inside it without a scrollbar-in-a-scrollbar or a cut-off result"]
after = []
+++

The operator's words, 2026-08-08: «это пока ок, в конце будем на сайт в тильде
встраивать». The GitHub Pages landing stays as-is; the calculator's real home
becomes a block inside his Tilda site. That replaces the withdrawn
`site-pitch` brief.

Two embed shapes, and the choice is the substance of this task — measure, do
not assume. An **iframe** (Tilda T123 HTML block) isolates our CSS from
Tilda's completely but has no natural height: the result card grows when a
quote renders, and without a height handshake the client gets a scrollbar
inside the page or a cut-off total. An **inline script** embed has no height
problem but inherits Tilda's typography and resets, which can silently wreck
the cost table on his theme.

Whatever you choose, the operator must end up with ONE snippet he can paste
without understanding it, and it must survive his phone: most of his clients
arrive from a Telegram link on a mobile.

Ask him in your pane for his Tilda page URL and test against the real thing —
a local iframe proves nothing about his theme. Do NOT touch site/calc.html or
src/page/main.ts (`task/importer-pricing` owns both, and it is changing the
form right now); build the embed as its own entry that reuses the renderer.
Record what you measured in docs/harness/tilda-embed.md, including anything
Tilda strips or rewrites — that file is the next person's map.
