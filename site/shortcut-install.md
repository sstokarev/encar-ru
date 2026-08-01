# iOS Shortcut and Android launch — loader install (dev doc, U3)

The bookmarklet and the iOS Shortcut share one thin loader (KTD4): it only
appends `<script src="https://encar-ru.example/widget.js?v=YYYYMMDD">` with the
`v` cache-bust computed from the current date at each run, no-ops outside
`*.encar.com`, and on repeat activation calls `window.__encarRu.rescan()`
instead of loading twice. `encar-ru.example` is the placeholder origin —
replace it with the GitHub Pages domain in U4 (single constant
`WIDGET_ORIGIN` in `src/loader/bookmarklet.ts`; rebuild and re-export after
changing it).

## Assembling the iOS Shortcut

1. Open the **Shortcuts** app on the iPhone and tap **+** to create a new
   shortcut. Name it `Encar RU`.
2. Add the action **Run JavaScript on Web Page** (search for "javascript").
   Leave its input as **Shortcut Input** so it receives the Safari page.
3. Paste the loader snippet below into the action's script field.
4. In the shortcut settings (ⓘ / share-sheet options), enable
   **Show in Share Sheet** and set accepted types to **Safari web pages**.
5. Usage: open a car page on `fem.encar.com` in Safari, tap **Share**, pick
   `Encar RU`.

### Loader snippet (inline)

The same logic as the bookmarklet, plus the `completion()` call that the
"Run JavaScript on Web Page" action requires (without it the action times
out with an error).

```javascript
(function () {
  var ORIGIN = "encar-ru.example"; // replace with the Pages domain in U4
  var host = location.hostname;
  if (host === "encar.com" || host.endsWith(".encar.com")) {
    if (window.__encarRu) {
      window.__encarRu.rescan();
    } else if (!document.querySelector(
      'script[src^="https://' + ORIGIN + '/widget.js"]')) {
      var d = new Date();
      var v = "" + d.getFullYear() +
        String(d.getMonth() + 1).padStart(2, "0") +
        String(d.getDate()).padStart(2, "0");
      var s = document.createElement("script");
      s.src = "https://" + ORIGIN + "/widget.js?v=" + v;
      s.referrerPolicy = "no-referrer";
      (document.head || document.documentElement).appendChild(s);
    }
  }
  completion(null); // required by the Shortcuts action
})();
```

Keep this snippet in sync with `src/loader/bookmarklet.ts` — that file is the
source of truth; this is its hand-inlined ES2017 equivalent for the Shortcut
field.

### Required setting: Allow Running Scripts

The action refuses to run until the user enables:

**Settings → Shortcuts → Advanced → Allow Running Scripts**

Put this step into the end-user guide (U8); the first run also asks for a
one-time permission prompt on the encar.com domain — tap **Allow**.

### Exporting via iCloud link

1. Long-press the shortcut → **Share** → **Copy iCloud Link**.
2. Publish that link in the guide. Recipients open it and tap
   **Add Shortcut** (formerly "Get Shortcut").
3. Re-export a new link after any change to the embedded script — iCloud
   links are snapshots, they do not auto-update. The loader itself almost
   never changes (KTD4): widget updates ship through `widget.js`.

## Android Chrome (bookmarklet via omnibox)

Android Chrome has no bookmarks bar, and tapping a `javascript:` bookmark
from the bookmark manager does nothing. Working path:

1. Create a bookmark for any page, then edit it: name `encar ru`, URL —
   paste the full `javascript:...` one-liner from `site/bookmarklet.txt`
   (built by `node scripts/build-bookmarklet.mjs`).
2. On an open `fem.encar.com` page, type the bookmark name (`encar ru`)
   into the omnibox (address bar) and tap the bookmark suggestion — Chrome
   executes the `javascript:` URL in the context of the current page.

This flow goes into the end-user guide (U8) with screenshots.
