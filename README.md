# encar-ru

Overlay widget for encar.com: injects all-in RUB prices next to KRW prices for clients of a car importer. No backend — static files on GitHub Pages, client-side computation, CBR FX rates. Delivered via iOS Shortcut / bookmarklet (thin loader + remote core). See `docs/plans/` for the full plan.

## Dev

```bash
npm install
npm test              # vitest, fixture-based DOM tests
npm run build         # esbuild -> site/widget.js
node scripts/build-bookmarklet.mjs   # -> site/bookmarklet.txt
```

Deploy: push to `main` → GitHub Actions builds and publishes `site/` to Pages.

## For the importer (Для импортёра)

Комиссия, тарифы и мессенджер для заявок задаются в файле `site/config.json` — правьте его прямо на GitHub (кнопка ✏️), изменения доедут до клиентов автоматически за ~10 минут.

**Безопасность:** доступ на запись в этот репозиторий равен исполнению кода в браузерах всех клиентов. Включена защита ветки `main`; используйте 2FA; не добавляйте соавторов без необходимости.
