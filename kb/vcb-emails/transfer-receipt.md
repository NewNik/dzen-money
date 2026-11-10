# Письмо «Biên lai chuyển tiền qua tài khoản» (Payment Receipt)

Отправитель: `VCBDigibank@info.vietcombank.com.vn` (DKIM/SPF/DMARC pass). HTML, UTF-8, base64, двуязычное.
Пример: [../samples/vcb-transfer-receipt.sample.txt](../samples/vcb-transfer-receipt.sample.txt).

## Поля (вьетнамская подпись / английская)
| Поле | Подписи | Пример |
|---|---|---|
| orderNumber | Số lệnh giao dịch / Order Number | 16929155058 |
| дата | Ngày, giờ giao dịch / Trans. Date, Time | `10:57 Sunday 08/11/2026` |
| debitAccount | Tài khoản nguồn / Debit Account | |
| remitter | Tên người chuyển tiền / Remitter's name | |
| creditAccount | Tài khoản người hưởng / Credit Account | |
| beneficiaryName | Tên người hưởng / Beneficiary Name | |
| beneficiaryBank | Tên ngân hàng hưởng / Beneficiary Bank Name | |
| amount | Số tiền / Amount | `74,000 VND` |
| chargeAmount | Số tiền phí / Charge Amount | `0 VND` |
| details | Nội dung chuyển tiền / Details of Payment | |

Вьетнамские подписи, кроме подтверждённых образцом, — предположения, сверять с реальными письмами.

## Правила разбора
- Дата DD/MM/YYYY HH:mm, UTC+7. В Дзен-мани `date` — локальная вьетнамская дата.
- Сумма: `74,000 VND` → 74000 (запятая — разделитель тысяч). Не VND → в очередь ручной проверки.
- Направление: оба счёта мои — перевод; только debit — расход; только credit — доход; иначе — неразобранное.
- Идемпотентность: UUIDv5 от `vcb:<orderNumber>`.
- Проверять `Authentication-Results`: dkim/spf/dmarc = pass, иначе карантин.
- Комиссия > 0 — отдельная операция с id от `vcb:<order>:fee`.

## Другие типы писем
Входящие переводы, оплата картой, снятие наличных, QR, изменение баланса — образцы не получены. См. открытые вопросы в [../plan.md](../plan.md).

## Наблюдения по реальным письмам (2026-11-10)

Прочитано 27 писем за 26.10–10.11.2026 по одному счёту. Значения ниже обезличены.

### Варианты письма
| Тема | Заголовок в теле | Отличия полей |
|---|---|---|
| Biên lai chuyển tiền qua tài khoản | Biên lai chuyển tiền qua tài khoản | базовый формат, см. выше |
| Biên lai chuyển tiền qua tài khoản | BIÊN LAI CHUYỂN TIỀN QUA TÀI KHOẢN/ THẺ | `Credit Account/ Card`, отдельное `Account number`, вместо `Amount` — `Debit Amount` и `Credit Amount`, есть `Exchange Rate`, нет `Remitter's name` |
| Biên lai thanh toán | Biên lai thanh toán | оплата счетов и QR Pay: `Bill code/Customer code`, нет банка получателя, `Details of Payment` начинается с `MBVCB.<order>.` |
| Biên lai chuyển tiền qua thẻ | — | перевод на карту, образец не разобран |

Служебные письма (регистрация Digibank, повторная активация, согласие на обработку данных) операций не содержат — пропускать по теме.

### Что важно для парсера
- Подписи в текстовой версии идут без косой черты: `Số tiền Amount`, а не `Số tiền / Amount`.
- Строка комиссии содержит три значения подряд: `Charge Amount Net income VAT | 0 VND 0 VND 0 VND` — брать первое.
- Gmail склеивает письма одного дня в цепочку: обрабатывать по сообщениям, не по цепочкам.
- `Credit Account` часто виртуальный (`VQRQ…`, `QRGD…`, `MS00P…`, `BHX…<код заказа>`) и у одного продавца меняется от платежа к платежу. Ключ получателя — имя + банк, не номер счёта.
- `Details of Payment` почти всегда `<ИМЯ ОТПРАВИТЕЛЯ> transfer` или номер заказа — для категорий бесполезно.
- В имени получателя встречается суффикс `_<цифры>` и префикс `HO KINH DOANH` (ИП) — срезать при нормализации.
