+++
branch = "task/site-pitch"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/site-pitch"
size = "deep"
size_why = "what the site now sells is the operator's decision, and the extension's fate rides on it"
owns = ["site/index.html"]
reads = ["site/calc.html", "site/bookmark.html", "site/shortcut-install.md", "docs/harness/project.md", "docs/harness/pipeline.md"]
accepts = ["operator opens the site root and reaches the calculator without knowing its URL, and the page tells a client who we are and that the quote is preliminary"]
after = []
+++

Measured 2026-08-08: `site/calc.html` is DEPLOYED and returns 200 on GitHub
Pages, and `site/index.html` links to it ZERO times. The calculator exists on
the internet and no client can find it. Meanwhile the landing page still
sells the old pitch — install the extension, copy the bookmarklet — which the
operator has replaced with the page.

Two things are the operator's call, not yours; brainstorm them in your pane
with the picker, one at a time, showing him what he will SEE:

1. **What the site leads with now.** Calculator first with the extension as a
   power-user extra, calculator only, or something else. The extension is not
   free to keep: `task/importer-pricing` is changing the config schema so an
   OLD bundled extension deliberately rejects the new config and falls back
   to its embedded tariffs with the «встроенные тарифы» marker — correct
   degradation, but every extension user keeps stale prices until they
   reinstall. Retiring or updating it is a real decision with a real cost.
2. **What a first-time client must be told** before he trusts a number:
   who the importer is, what «под ключ во Владивостоке» includes and excludes,
   and that the quote is preliminary. Today the page is a bare input field.

Do not touch `site/calc.html` — `task/importer-pricing` owns it. If the
calculator itself needs a change, report it; do not reach across.
