# Every v0.6.0 extension install is now frozen on its embedded tariffs

**Seen:** by design, and it is the right design — but the operational
consequence deserves a decision rather than a comment.

`site/config.json` now carries cost items of kind `krw` and `ladder`. The
validator bundled into extension v0.6.0 (`isCostItem`, a `switch` with
`default: return false`, gated by `costItems.every(...)`) rejects the whole
config. Verified against `git show origin/main:src/config.ts`. Those clients
fall back to `DEFAULT_CONFIG` and keep quoting today's honest dashed model
behind the «встроенные тарифы» marker.

That is strictly better than the alternative — new top-level keys would have
been silently ignored and an old client would have printed a confident total
~3.7% low. No old client can be made to print a wrong number.

**What it costs:** `site/config.json` is now **inert** for every v0.6.0 install
until the user updates. Two consequences nobody has decided on:

1. It stops being a kill switch for them. Until today, editing the deployed
   config could correct a tariff, change the Telegram handle, or take a broken
   line down for every client at once. For v0.6.0 installs that lever is gone —
   the only remaining lever is shipping v0.7.0 and getting people to reinstall.
2. Nobody knows how many installs that is, or whether they update. The extension
   is side-loaded (`site/encar-ru-extension.zip`), so there is no store
   auto-update. A client on 0.6.0 could quote the old dashed model for months
   while the operator believes everyone sees the new one.

**Shape of the fix:** not code — a decision plus, probably, one small change.
The decision: is the side-loaded install base worth a migration push (a note on
the site, a message to clients), or is the calc page now the product and the
extension a legacy surface? The small change, if the answer is "keep it alive":
give the widget a visible version line so a client can read out what they are
running, and give the config a `minWidgetVersion` field that a NEW bundle
honours — so the next schema break can tell an old client "update" instead of
silently reverting it to embedded data.

Raised because this branch created the situation; the call is not a pricing
worker's to make.

> **Verdict:**
