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
