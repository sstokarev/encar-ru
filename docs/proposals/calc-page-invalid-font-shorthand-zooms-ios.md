# `site/calc.html`: невалидный шорткат `font` роняет кегль поля и зумит iOS

**Filed by:** `task/landing`, 2026-08-08. Report, not a fix — `site/calc.html`
is owned by `task/importer-pricing`.

## The defect

```css
input[data-calc-url]{… font:1rem inherit; font-family:inherit}
button[data-calc-submit]{… font:600 1rem inherit; font-family:inherit}
```

Both `font` declarations are invalid and dropped by the CSS parser. The
shorthand requires a font-family, and `inherit` is legal only as the value of
the *whole* declaration, not as its family component. The trailing
`font-family:inherit` still applies, so the family is right — but the
`font-size` never lands, and the input falls back to the UA default (~13px in
Safari and Chrome).

## Why it matters

Any input whose computed `font-size` is under 16px makes iOS Safari zoom the
page on focus, and it does not zoom back out — the client is left scrolled
sideways on a page he opened from a Telegram link. Most of this product's
traffic is exactly that.

## Fix

```
-  font:1rem inherit;font-family:inherit
+  font-size:1rem;font-family:inherit
```

and on the button:

```
-  font:600 1rem inherit;font-family:inherit
+  font-size:1rem;font-weight:600;font-family:inherit
```

Already applied in `site/landing.html`, which had inherited the same block by
copy. `site/index.html` carries a third copy (`button.copy{font:600 1rem/1
inherit}`) with the same flaw — that one is on a tap target rather than a
text input, so it costs weight and size, not a zoom.

Found by the code review of `task/landing`, 2026-08-08.

> **Verdict:** taken — relayed into task/importer-pricing round 2 the hour it
> was filed (it owns site/calc.html). A focused input under 16px zooms iOS
> Safari, and the operator's clients arrive from a Telegram link on a phone:
> the page jumps the moment a client taps the field. site/index.html carries
> the same defect and rides the next dispatch that touches it.
