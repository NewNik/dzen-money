// Разбор писем Vietcombank (VCB Digibank). Форматы: kb/vcb-emails/transfer-receipt.md.
import { htmlToCells } from '../html';
import { normalize } from '../text';
import type { ParsedBankTxn, VcbEmailType } from '../types';

export class VcbParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VcbParseError';
  }
}

type Field =
  | 'date' | 'order' | 'debit' | 'remitter' | 'credit' | 'accountNumber' | 'beneficiary'
  | 'bank' | 'bill' | 'amount' | 'debitAmount' | 'creditAmount' | 'fee' | 'details' | 'rate';

// Подписи сравниваются по английской части, после нормализации, по концу ячейки.
const LABELS: Array<[Field, RegExp]> = [
  ['date', /trans\. date, time$/],
  ['order', /order number$/],
  ['debit', /debit account$/],
  ['remitter', /remitter's name$/],
  ['credit', /(credit account( ?\/ ?card)?|destination card number)$/],
  ['accountNumber', /account number$/],
  ['bank', /beneficiary bank name$/],
  ['beneficiary', /beneficiary name$/],
  ['bill', /bill code ?\/ ?customer code$/],
  ['debitAmount', /debit amount$/],
  ['creditAmount', /credit amount$/],
  ['fee', /(charge|fee) amount net income vat$/],
  ['amount', /(^| )so tien amount$/],
  ['details', /details of payment$/],
  ['rate', /exchange rate$/],
];

function fieldOf(cell: string): Field | undefined {
  const n = normalize(cell);
  for (const [field, re] of LABELS) if (re.test(n)) return field;
  return undefined;
}

/** "1,234,567 VND" → 1234567. Не VND или нечисло → ошибка, а не 0. */
export function parseVnd(text: string, what: string): number {
  const m = /^(\d{1,3}(?:,\d{3})*|\d+)\s*([A-Z]{3})\b/.exec(text.trim());
  if (!m) throw new VcbParseError(`не разобрана сумма (${what})`);
  if (m[2] !== 'VND') throw new VcbParseError(`валюта ${m[2]} не поддерживается (${what})`);
  return Number((m[1] ?? '').replace(/,/g, ''));
}

/** "10:57 Sunday 08/11/2026" → дата и время UTC+7. */
export function parseVcbDate(text: string): { dateLocal: string; occurredAtLocal: string } {
  const m = /(\d{2}):(\d{2})\s+\S+\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  if (!m) throw new VcbParseError('не разобрана дата');
  const [, hh, mm, dd, mo, yyyy] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(dd) < 1 || Number(dd) > 31 || Number(hh) > 23 || Number(mm) > 59) {
    throw new VcbParseError('некорректная дата');
  }
  const dateLocal = `${yyyy}-${mo}-${dd}`;
  return { dateLocal, occurredAtLocal: `${dateLocal}T${hh}:${mm}:00+07:00` };
}

function emailType(cells: string[]): VcbEmailType {
  const all = normalize(cells.join(' | '));
  if (all.includes('bien lai chuyen tien qua tai khoan/ the')) return 'transfer_account_card';
  if (all.includes('bien lai chuyen tien qua the')) return 'card_transfer';
  if (all.includes('bien lai thanh toan')) return 'bill_payment';
  if (all.includes('bien lai chuyen tien qua tai khoan')) return 'transfer_receipt';
  throw new VcbParseError('неизвестный тип письма');
}

export function parseVcbEmail(html: string): ParsedBankTxn {
  const cells = htmlToCells(html);
  const type = emailType(cells);
  const f: Partial<Record<Field, string>> = {};
  for (let i = 0; i < cells.length - 1; i++) {
    const field = fieldOf(cells[i] ?? '');
    const value = cells[i + 1] ?? '';
    if (!field || f[field] !== undefined || fieldOf(value)) continue;
    f[field] = value;
  }
  const need = (field: Field, title: string): string => {
    const v = f[field];
    if (!v) throw new VcbParseError(`нет поля: ${title}`);
    return v;
  };
  const order = need('order', 'Order Number');
  if (!/^\d{6,20}$/.test(order)) throw new VcbParseError('некорректный Order Number');
  const debit = need('debit', 'Debit Account');
  if (!/^\d{6,20}$/.test(debit)) throw new VcbParseError('некорректный Debit Account');
  const { dateLocal, occurredAtLocal } = parseVcbDate(need('date', 'Trans. Date, Time'));

  let amount: number;
  if (f.amount !== undefined) {
    amount = parseVnd(f.amount, 'Amount');
  } else {
    amount = parseVnd(need('debitAmount', 'Amount'), 'Debit Amount');
    if (f.creditAmount !== undefined && parseVnd(f.creditAmount, 'Credit Amount') !== amount) {
      throw new VcbParseError('суммы списания и зачисления различаются');
    }
  }
  if (!(amount > 0)) throw new VcbParseError('сумма должна быть больше 0');
  // В ячейке комиссии три значения: комиссия, чистый доход банка, НДС. Нужна первая.
  const feeAmount = f.fee === undefined ? 0 : parseVnd(f.fee, 'Charge Amount');

  return {
    source: 'vcb-email',
    emailType: type,
    orderNumber: order,
    occurredAtLocal,
    dateLocal,
    amount,
    currency: 'VND',
    feeAmount,
    debitAccount: debit,
    creditAccount: f.accountNumber ?? f.credit,
    remitterName: f.remitter,
    beneficiaryName: need('beneficiary', 'Beneficiary Name'),
    beneficiaryBank: f.bank,
    billCode: f.bill,
    details: f.details,
  };
}

/** Письмо считается подлинным, только если DKIM, SPF и DMARC — pass. */
export function parseAuthResults(header: string): { dkim: boolean; spf: boolean; dmarc: boolean } {
  const h = header.toLowerCase();
  return { dkim: /\bdkim=pass\b/.test(h), spf: /\bspf=pass\b/.test(h), dmarc: /\bdmarc=pass\b/.test(h) };
}

export const VCB_SENDER = 'vcbdigibank@info.vietcombank.com.vn';
