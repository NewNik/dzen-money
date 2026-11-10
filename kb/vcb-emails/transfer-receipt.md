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
