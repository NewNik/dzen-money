# dzen-money

Автоматический учёт финансов: письма Vietcombank (VCB Digibank) в Gmail → операции в Дзен-мани.

- `kb/` — база знаний: план, заметки по API, форматы писем, решения
- `app/` — код приложения (TypeScript, Google Apps Script + переносимое ядро)

Статус: этапы 0–1 сделаны; этап 2 (чтение Gmail, dry-run) написан, ждёт развёртывания — [kb/setup-apps-script.md](kb/setup-apps-script.md). См. [kb/plan.md](kb/plan.md).

## Важно про данные

Сырые письма (`.eml`) и секреты в git не попадают (см. `.gitignore`).
В `kb/samples/` и `app/fixtures/` — только обезличенные примеры.
