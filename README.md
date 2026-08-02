# encar-ru

Overlay widget for encar.com: injects all-in RUB prices next to KRW prices for clients of a car importer. No backend — static files on GitHub Pages, client-side computation, CBR FX rates. Delivered via iOS Shortcut / bookmarklet (thin loader + remote core). See `docs/plans/` for the full plan.

## Dev

```bash
npm install
npm test                  # vitest, fixture-based DOM tests
npm run build             # esbuild -> site/widget.js
npm run build:bookmarklet # -> site/bookmarklet.txt
npm run build:extension   # -> extension/widget.js, site/encar-ru-extension.zip
```

Two delivery paths, same core:

- **Extension (desktop Chrome/Edge/Opera/Яндекс)** — installed once, the content
  script runs on every `*.encar.com` page by itself. MV3 forbids remotely hosted
  code, so `widget.js` is bundled INTO the extension: a core fix reaches those
  clients only when they reinstall. `manifest.json`'s version must equal
  `VERSION` in `src/main.ts` — the build fails otherwise.
- **Bookmarklet (iPhone, and desktop without an extension)** — a thin loader
  that fetches the core from Pages, so core fixes reach those clients on the
  next tap. It cannot survive a page load: encar navigates normally between
  `www` and `fem`, so it is one tap per page. iOS Safari has no extension path
  that avoids the App Store.

`config.json` and the CBR rates stay remote for BOTH paths — they are data, not
code, so the importer can change tariffs without shipping anything.

Deploy: push to `main` → GitHub Actions builds and publishes `site/` to Pages.

## For the importer (Для импортёра)

Комиссия, тарифы и мессенджер для заявок задаются в файле `site/config.json` — правьте его прямо на GitHub (кнопка ✏️).

Что можно править (по полям файла):

- `messenger` — куда ведёт кнопка «Заказать»: тип (`telegram`/`whatsapp`) и адрес/номер.
- `currency.referenceRates` — резервные курсы KRW→RUB и EUR→RUB: используются, только если курс ЦБ временно недоступен; обновляйте вместе с датой `updatedAt`.
- `costItems` — строки расчёта: у `"kind": "fixed"` поле `value` — сумма в рублях (доставка, СБКТС/ЭПТС, брокер), у `"kind": "percent"` — процент комиссии от цены машины, `label` — текст строки для клиента.
- `customs.asOf` — месяц, на который актуальны таможенные таблицы ниже; меняйте при каждом обновлении ставок.
- `customs.dutyValueTiers` / `customs.dutyPerCcByAge` — таблицы пошлины: для машин младше 3 лет (процент от стоимости с минимумом €/см³) и для 3–5 / старше 5 лет (€/см³ по объёму двигателя).
- `customs.recyclingFee` — утилизационный сбор: фиксированные суммы в рублях по объёму и возрасту.
- `customs.clearanceFeeBrackets` — сбор за таможенное оформление: ступени в рублях по таможенной стоимости.
- `commissionNote` — дисклеймер под расчётом в плашке.

После сохранения на GitHub изменения доезжают до клиентов автоматически: сборка и публикация на Pages плюс кэш CDN — обычно ~5–15 минут; браузер клиента конфиг не кэширует (запрашивается заново при каждом запуске виджета).

**Безопасность:** доступ на запись в этот репозиторий равен исполнению кода в браузерах всех клиентов. Включена защита ветки `main`; используйте 2FA; не добавляйте соавторов без необходимости.
