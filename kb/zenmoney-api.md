# API Дзен-мани

Источники: https://github.com/zenmoney/ZenPlugins/wiki/ZenMoney-API , issue ZenPlugins#1236 (ноябрь 2026, наблюдения сообщества).

## Доступ
- OAuth 2.0: `https://api.zenmoney.ru/oauth2/authorize/`, `.../oauth2/token/`. Свой клиент — заявка через форму из wiki (регистрируют только реальные проекты).
- Для личного использования wiki предлагает взять токен у зарегистрированного сервиса (например zerro.app/token).
- Токен zerro.app бессрочный (так заявлено на странице zerro.app/token, 2026-11-10). Алерт на 401 всё равно нужен.
- Заголовок: `Authorization: Bearer <токен>`.
- Домены: `api.zenmoney.ru` (проверен, отвечает), `api.zenmoney.app` (запасной).

## Эндпоинты
Только два: `POST /v8/diff/` (синхронизация) и `POST /v8/suggest/` (подсказка категории/получателя). Классического REST нет.

## diff
Запрос: `currentClientTimestamp`, `serverTimestamp` (0 при первой синхронизации), массивы изменённых объектов (`transaction`, ...). Ответ: изменения сервера и новый `serverTimestamp`. Конфликты — по полю `changed`.
Системные сущности (Instrument, Company, User) — только чтение.

## Transaction
`id` (UUID, генерирует клиент), `changed`, `created`, `user`, `deleted`, `hold`, `incomeInstrument`, `incomeAccount`, `income`, `outcomeInstrument`, `outcomeAccount`, `outcome`, `tag[]`, `merchant`, `payee`, `originalPayee`, `comment`, `date` (`yyyy-MM-dd`), `mcc`, `reminderMarker`, `opIncome/opOutcome` + инструменты, `latitude/longitude`.

Тип операции — по комбинации полей:
- расход: `incomeAccount = outcomeAccount`, `income = 0`, `outcome = сумма`
- доход: тот же счёт, `income = сумма`, `outcome = 0`
- перевод: разные счета в `outcomeAccount` и `incomeAccount`

## Нюансы
- Отправлять объект полностью, nullable-поля явно `null`.
- Недокументированные обязательные ключи: у Account `role`, `balance`, `startBalance`, `creditLimit`, `private`; у Tag `parent`.
- id VND брать из ответа diff (`shortTitle === 'VND'`), не хардкодить.
- Account `syncID` — последние 4 цифры номера счёта.
- Лимиты частоты не опубликованы: один diff на запуск пакетом, backoff.
- Проверять результат повторным diff.

## Проверено на живом аккаунте (этап 0, 2026-11-10, только чтение)
- `POST /v8/diff/` с `serverTimestamp: 0` → 200, полный дамп ~2,4 МБ (около 3000 операций). Полную выгрузку делать один раз, дальше хранить `serverTimestamp` и запрашивать только изменения.
- Сущности в ответе: `instrument`, `country`, `company`, `user`, `account`, `tag`, `budget`, `merchant`, `reminder`, `reminderMarker`, `transaction`.
- VND: `instrument.id = 11902`. Vietcombank: `company.id = 15723`. Значения системные, но в коде всё равно искать по `shortTitle`.
- Аккаунт семейный: два пользователя (родительский и дочерний с `parent`). Все счета и операции записаны на родительского — его id и ставить в `transaction.user`.
- Счетов VCB два (оба `type: ccard`, VND). `syncID` у них `null` — сопоставлять только по конфигу «номер счёта → UUID».
- Фактические поля Transaction отличаются от wiki: есть `incomeBankID`, `outcomeBankID`, `qrCode`, `source`, `viewed`; поля `mcc` нет. У ручных операций `source: null`, `hold: null`.
- Запись проверена: расход 1 VND с комментарием `[vcb:test]`, полный объект со всеми nullable-полями → 200, в ответе изменённые `account` и `transaction`. Повтор с тем же `id` дубля не создал, баланс уменьшился на 1 один раз. Тестовую операцию удалить вручную в приложении.
- Запрос с актуальным `serverTimestamp` возвращает только изменения (ответ на запись — 1 счёт и 1 операция).

## Автокатегория на сервере (наблюдение 10.11.2026)
- Операция, записанная скриптом с `tag: null` и `payee` = имя получателя из письма, через ~1 с получила на сервере категорию («Рестораны»): `changed` = `created` + 1 с. Других операций с этим получателем в учёте не было — это собственная подсказка Дзен-мани по `payee`, а не правило пользователя.
- Значит, `tag: null` не означает «без категории». Если категорию поправить в приложении, скрипт её не затрёт (операция с существующим id повторно не отправляется), а Дзен-мани, по-видимому, запомнит получателя.
- На этапе 4 решить: свои правила → `/v8/suggest/` → отдавать категорию явно.

## Удаление окончательное (проверено 10.11.2026)
- Удалённая в приложении операция остаётся в `diff` с `deleted: true` (в `deletion[]` её нет).
- Повторная отправка того же id с `deleted: false` и свежим `changed` → 200, но операция не восстанавливается и в ответе не возвращается; её `changed` не меняется.
- Поэтому повторная запись (свойство `REDO`) идёт с новым id `UUIDv5("vcb:<order>:r<N>")`, а «уже записано» определяется и по id, и по метке `[vcb:<order>]` в комментарии живой операции.
