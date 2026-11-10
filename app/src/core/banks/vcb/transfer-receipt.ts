// Парсер письма «Biên lai chuyển tiền qua tài khoản» (Payment Receipt).
// Формат описан в kb/vcb-emails/transfer-receipt.md.
import { htmlToCells, normalizeText } from '../../html';
import type { ParsedBankTxn, TxnKind } from '../../types';

type Field =
  | 'dateTime'
  | 'orderNumber'
  | 'debitAccount'
  | 'remitter'
  | 'creditAccount'
  | 'beneficiaryName'
  | 'beneficiaryBank'
  | 'amount'
  | 'chargeCode'
  | 'chargeAmount'
  | 'details';

// Словарь подписей: вьетнамская и английская. Сравнение точное, без учёта регистра.
const LABELS: Record<Field, string[]> = {
  dateTime: ['Ngày, giờ giao dịch', 'Trans. Date, Time'],
  orderNumber: ['Số lệnh giao dịch', 'Order Number'],
  debitAccount: ['Tài khoản nguồn', 'Debit Account'],
  remitter: ['Tên người chuyển tiền', "Remitter's name"],
  creditAccount: ['Tài khoản người hưởng', 'Credit Account'],
  beneficiaryName: ['Tên người hưởng', 'Beneficiary Name'],
  beneficiaryBank: ['Tên ngân hàng hưởng', 'Beneficiary Bank Name'],
  amount: ['Số tiền', 'Amount'],
  chargeCode: ['Loại phí', 'Charge Code'],
  chargeAmount: ['Số tiền phí', 'Charge Amount'],
  details: ['Nội dung chuyển tiền', 'Details of Payment'],
};

const REQUIRED: Field[] = ['dateTime', 'orderNumber', 'amount', 'chargeAmount'];

const key = (s: string): string => normalizeText(s).toLowerCase().replace(/[’`]/g, "'");

const LABEL_INDEX = new Map<string, Field>();
for (const f of Object.keys(LABELS) as Field[]) for (const l of LABELS[f]) LABEL_INDEX.set(key(l), f);

/** Если ячейка — подпись (возможно «vi / en:» и значение после двоеточия), вернуть поле и хвост. */
function asLabel(cell: string): { field: Field; inline: string } | null {
  const colon = cell.indexOf(':');
  const head = colon >= 0 ? cell.slice(0, colon) : cell;
  const inline = colon >= 0 ? normalizeText(cell.slice(colon + 1)) : '';
  let field: Field | undefined;
  for (const part of head.split('/')) {
    const f = LABEL_INDEX.get(key(part));
    if (f === undefined) return null; // все части должны быть подписями
    if (field !== undefined && field !== f) return null;
    field = f;
  }
  return field === undefined ? null : { field, inline };
}

/** Для обезличивания: подпись ли это, и если да — её текст и значение после двоеточия. */
export function splitLabel(cell: string): { head: string; inline: string } | null {
  const lab = asLabel(cell);
  if (!lab) return null;
  const colon = cell.indexOf(':');
  return { head: colon >= 0 ? cell.slice(0, colon) : cell, inline: lab.inline };
}

/** Значение — хвост той же ячейки либо первая следующая ячейка, не являющаяся подписью. */
export function extractFields(cells: string[]): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  for (let i = 0; i < cells.length; i++) {
    const lab = asLabel(cells[i]!);
    if (!lab || out[lab.field] !== undefined) continue;
    if (lab.inline) {
      out[lab.field] = lab.inline;
      continue;
    }
    for (let j = i + 1; j < cells.length; j++) {
      const next = asLabel(cells[j]!);
      if (!next) {
        out[lab.field] = cells[j]!;
        break;
      }
      // вторая половина двуязычной подписи того же поля — пропускаем; другое поле — значения нет
      if (next.field !== lab.field) break;
      if (next.inline) {
        out[lab.field] = next.inline;
        break;
      }
    }
  }
  return out;
}

/** `10:57 Sunday 08/11/2026` → локальное вьетнамское время (UTC+7). */
export function parseVcbDateTime(s: string): { occurredAtLocal: string; dateLocal: string } | null {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\D+?(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (!m) return null;
  const [hh, mi, ss, dd, mo, yyyy] = [m[1]!, m[2]!, m[3] ?? '00', m[4]!, m[5]!, m[6]!].map(Number) as [
    number, number, number, number, number, number,
  ];
  if (hh > 23 || mi > 59 || ss > 59 || mo < 1 || mo > 12 || dd < 1) return null;
  if (dd > new Date(Date.UTC(yyyy, mo, 0)).getUTCDate()) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  const dateLocal = `${yyyy}-${p(mo)}-${p(dd)}`;
  return { occurredAtLocal: `${dateLocal}T${p(hh)}:${p(mi)}:${p(ss)}+07:00`, dateLocal };
}

/** `74,000 VND` → 74000. Запятая — разделитель тысяч, точка — десятичный. */
export function parseVcbAmount(s: string): { amount: number; currency: string } | null {
  const m = /^(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?\s*([A-Za-z]{3})$/.exec(normalizeText(s));
  if (!m) return null;
  const amount = Number(m[1]!.replace(/,/g, '') + (m[2] ?? ''));
  return Number.isFinite(amount) ? { amount, currency: m[3]!.toUpperCase() } : null;
}

const digits = (s: string | undefined): string | undefined => {
  const d = s?.replace(/[\s.-]/g, '');
  return d && /^\d+$/.test(d) ? d : undefined;
};

export function classify(debit: string | undefined, credit: string | undefined, own: readonly string[]): TxnKind {
  const d = debit !== undefined && own.includes(debit);
  const c = credit !== undefined && own.includes(credit);
  return d && c ? 'transfer' : d ? 'expense' : c ? 'income' : 'unknown';
}

export interface ParseContext {
  gmailMessageId: string;
  auth: ParsedBankTxn['auth'];
  /** Номера своих счётов — для определения направления. */
  ownAccounts: readonly string[];
}

export type ParseResult = { ok: true; txn: ParsedBankTxn } | { ok: false; error: string };

export function parseTransferReceiptCells(cells: string[], ctx: ParseContext): ParseResult {
  const f = extractFields(cells);
  const missing = REQUIRED.filter((k) => !f[k]);
  if (missing.length) return { ok: false, error: `нет полей: ${missing.join(', ')}` };

  const dt = parseVcbDateTime(f.dateTime!);
  if (!dt) return { ok: false, error: 'не разобрана дата' };
  const amount = parseVcbAmount(f.amount!);
  if (!amount || amount.amount <= 0) return { ok: false, error: 'не разобрана сумма' };
  const fee = parseVcbAmount(f.chargeAmount!);
  if (!fee) return { ok: false, error: 'не разобрана комиссия' };
  if (fee.amount > 0 && fee.currency !== amount.currency) return { ok: false, error: 'валюта комиссии отличается' };
  const orderNumber = f.orderNumber!.replace(/\s/g, '');
  if (!/^[A-Za-z0-9-]+$/.test(orderNumber)) return { ok: false, error: 'не разобран Order Number' };

  const debitAccount = digits(f.debitAccount);
  const creditAccount = digits(f.creditAccount);
  return {
    ok: true,
    txn: {
      source: 'vcb-email',
      emailType: 'transfer_receipt',
      gmailMessageId: ctx.gmailMessageId,
      orderNumber,
      ...dt,
      amount: amount.amount,
      currency: amount.currency,
      feeAmount: fee.amount,
      debitAccount,
      creditAccount,
      remitter: f.remitter,
      beneficiaryName: f.beneficiaryName,
      beneficiaryBank: f.beneficiaryBank,
      details: f.details,
      kind: classify(debitAccount, creditAccount, ctx.ownAccounts),
      auth: ctx.auth,
    },
  };
}

export function parseTransferReceipt(html: string, ctx: ParseContext): ParseResult {
  return parseTransferReceiptCells(htmlToCells(html), ctx);
}
