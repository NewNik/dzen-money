# API Дзен-мани

Источники: https://github.com/zenmoney/ZenPlugins/wiki/ZenMoney-API , issue ZenPlugins#1236 (ноябрь 2026, наблюдения сообщества).

## Доступ
- OAuth 2.0: `https://api.zenmoney.ru/oauth2/authorize/`, `.../oauth2/token/`. Свой клиент — заявка через форму из wiki (регистрируют только реальные проекты).
- Для личного использования wiki предлагает взять токен у зарегистрированного сервиса (например zerro.app/token).
- Срок жизни такого токена не подтверждён. Закладывать алерт на 401.
- Домены: `api.zenmoney.ru`, `api.zenmoney.app` (если `.ru` недоступен из Вьетнама).

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
