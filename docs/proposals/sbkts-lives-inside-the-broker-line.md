# СБКТС/ЭПТС не исчезли — они внутри брокерской строки

**Filed by:** `task/landing`, 2026-08-08. Report, not a fix — the files are
owned by `task/importer-pricing`.

## What the operator said

`docs/tasks/importer-pricing.md` left a question open: «There is **no
СБКТС/ЭПТС line** — his quote is «под ключ во Владивостоке». Ask him in your
pane whether it disappears or moves.»

Asked in the landing pane, 2026-08-08. His answer, verbatim:

> СБКТС/ЭПТС входит в стоимость фиксированных брокерских услуг

So it **moves**, it does not disappear. The fixed 116 000 RUB line — today
labelled `Брокер и СВХ` in `site/config.json` — already pays for the
certificate and the electronic passport.

## Why it matters outside the label

1. **The client cannot tell.** «Брокер и СВХ» reads as pure logistics.
   A buyer comparing importers assumes СБКТС is a separate 30–50k he still
   owes, and prices the offer as more expensive than it is. The landing's
   own trust copy names СБКТС and ЭПТС explicitly for exactly this reason;
   with the current config label the page and the cost table disagree.
2. **`site/config.json` is the single source of the label.** The landing
   renders the table through `initCalcPage` and does not (and must not)
   rewrite line labels, so this can only be fixed where the line is defined.

## Suggested change (owner's call)

In `site/config.json`, the `broker` cost item label:

```
-  "label": "Брокер и СВХ"
+  "label": "Брокер, СВХ, СБКТС и ЭПТС"
```

The number does not change — 116 000 RUB already covers it. This is a naming
fix, so `test/pricing.test.ts`'s pin on 5 045 020 stays green.

If the label is judged too long for a phone-width row, the alternative is the
existing per-line note slot (`[data-line-note]` in `src/page/render.ts`)
rather than dropping the fact.
