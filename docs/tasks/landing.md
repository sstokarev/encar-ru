+++
branch = "task/landing"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/landing"
size = "deep"
size_why = "the pitch and what a client is told before he trusts a number are the operator's calls, made in your pane"
owns = ["site/landing.html", "src/page/landing.ts", "test/landing.test.ts"]
reads = ["site/calc.html", "src/page/main.ts", "src/page/render.ts", "site/index.html", "docs/harness/project.md", "docs/harness/pipeline.md"]
accepts = ["operator opens the landing on his phone, understands within one screen who this is and what the price includes, gets a full quote from a real listing link, and taps through to Telegram"]
after = []
+++

The operator's words, 2026-08-08: «первая версия - отдельным лендосом в репо»,
and the Tilda embed is explicitly later («только потом будем встраивать, не
торопись»). So: ONE standalone page in this repo, deployed with the rest on
GitHub Pages, that a client can be sent to cold.

What exists and must not be rebuilt: `site/calc.html` is the bare calculator
and `src/page/main.ts` already exports `initCalcPage(...)` — mount the same
markup on your page and call it. Both files belong to `task/importer-pricing`,
which is changing the form right now: import from them, never edit them. Your
page file name is your call.

The substance is what the page SAYS, and it is the operator's, not yours —
brainstorm in your pane, one question at a time, options showing what he will
see: who the importer is, what «под ключ во Владивостоке» covers and what it
does not (СБКТС/ЭПТС is deliberately absent from his own quote), that the
quote is preliminary and the rate is CBR while he pays a bank rate, and what
happens after the client taps Telegram.

Traps already paid for: most clients arrive from a Telegram link on a phone,
so the phone is the primary layout, not the fallback. The existing
`site/index.html` still sells the extension and the bookmarklet — leave it
alone, this page does not have to replace it yet.
