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
| chargeCode | Loại phí / Charge Code | `Người chuyển trả / Exclude` |
| chargeAmount | Số tiền phí / Charge Amount | `0 VND` (в настоящем письме — многострочно, см. ниже) |
| details | Nội dung chuyển tiền / Details of Payment | |

Вьетнамские подписи, кроме подтверждённых образцом, — предположения, сверять с реальными письмами.

## Настоящая вёрстка (образец от 10.11.2026)
Получена через `dumpSample`, фикстура — `app/fixtures/vcb/transfer_receipt/03-real-layout-vat.html`.
- Таблица: подпись `<b>vi</b><br><i>en</i>` в левой ячейке, значение — в правой `colspan="3"`.
- Подпись «Remitter’s name» — с типографским апострофом `’`.
- Строка комиссии — четыре ячейки в одной `<tr>`:
  - «Loại phí / Charge Code» → `<vi-значение><br><i>Exclude</i>`;
  - «Số tiền phí» / «Charge Amount<br>??? ??????<br>VAT» → `0 VND<br>&nbsp;<br>0 VND<br>0 VND`.
  Третья подпись в образце замаскирована (2 слова, 3 и 6 букв). По расположению строк: первая сумма — комиссия, две последние — вероятно, комиссия без VAT и VAT.
- Разбор: берётся первая сумма из ячеек между подписью комиссии и следующей подписью. Если сумм несколько и хоть одна ненулевая — ошибка `ненулевая комиссия с разбивкой (VAT)`: включает ли первая сумма VAT, пока не подтверждено. Нужен образец письма с ненулевой комиссией.

## Правила разбора
- Дата DD/MM/YYYY HH:mm, UTC+7. В Дзен-мани `date` — локальная вьетнамская дата.
- Сумма: `74,000 VND` → 74000 (запятая — разделитель тысяч). Не VND → в очередь ручной проверки.
- Направление: оба счёта мои — перевод; только debit — расход; только credit — доход; иначе — неразобранное.
- Идемпотентность: UUIDv5 от `vcb:<orderNumber>`.
- Проверять `Authentication-Results`: dkim/spf/dmarc = pass, иначе карантин.
- Комиссия > 0 — отдельная операция с id от `vcb:<order>:fee`.
- Если назначение не введено, VCB подставляет в Details of Payment «<имя отправителя> transfer» (подтверждено письмом 10.11.2026). В комментарий Дзен-мани такой автотекст не идёт — только маркер `[vcb:<order>]`.

## Оплата счетов (наблюдение 07.11.2026)
Оплата электричества приходит тем же письмом: получатель `EVN Miền Trung`, назначение `MBVCB<order>_<YYYYMMDD>_EVNCPC_<лицевой счёт>`.
`EVNCPC` — код поставщика (EVN Central Power Corporation), `PQ…` — номер договора у поставщика. Категория — правилом `/(^|[^a-z])evn/` → «Коммуналка» (`app/config/rules.json`).

## Реализация
`app/src/core/banks/vcb/transfer-receipt.ts`. Подпись ищется точным сравнением (части «vi / en», без учёта регистра), значение — хвост ячейки после двоеточия либо следующая ячейка, не являющаяся подписью. Обязательные поля: дата, Order Number, сумма, комиссия; при отсутствии — ошибка.

Фикстуры `01`, `02` — синтетические; `03` — настоящая вёрстка с синтетическими значениями.

## Другие типы писем
Входящие переводы, оплата картой, снятие наличных, QR, изменение баланса — образцы не получены. См. открытые вопросы в [../plan.md](../plan.md).
