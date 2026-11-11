// Решение по одному письму: карантин, не разобрано или разобрано. Без Gmail/GAS API.
import { isTrusted, parseAuthResults, topAuthResultsHeader, type AuthResult } from './auth';
import { parseTransferReceipt } from './banks/vcb/transfer-receipt';
import { parseGrabReceipt, type GrabReceipt } from './receipts/grab/e-receipt';
import type { ParsedBankTxn } from './types';

export const VCB_SENDER = 'vcbdigibank@info.vietcombank.com.vn';
export const VCB_ORG_DOMAIN = 'vietcombank.com.vn';

export interface EmailInput {
  id: string;
  from: string;
  html: string;
  /** Сырое письмо целиком (нужны только заголовки). */
  raw: string;
}

export type Outcome =
  | { status: 'parsed'; txn: ParsedBankTxn }
  | { status: 'unparsed'; reason: string; auth: AuthResult }
  | { status: 'quarantine'; reason: string; auth: AuthResult };

const address = (from: string): string => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();

export function processEmail(msg: EmailInput, ownAccounts: readonly string[]): Outcome {
  const auth = parseAuthResults(topAuthResultsHeader(msg.raw), VCB_ORG_DOMAIN);
  if (address(msg.from) !== VCB_SENDER) return { status: 'quarantine', reason: 'чужой отправитель', auth };
  if (!isTrusted(auth)) return { status: 'quarantine', reason: 'не прошла проверка DKIM/DMARC', auth };
  const r = parseTransferReceipt(msg.html, { gmailMessageId: msg.id, auth, ownAccounts });
  return r.ok ? { status: 'parsed', txn: r.txn } : { status: 'unparsed', reason: r.error, auth };
}

export const GRAB_SENDER = 'no-reply@grab.com';
export const GRAB_ORG_DOMAIN = 'grab.com';
export const GRAB_RECEIPT_SUBJECT = 'Your Grab E-Receipt';

export type ReceiptOutcome =
  | { status: 'receipt'; receipt: GrabReceipt }
  /** Письмо Grab, но не чек (реклама, уведомление). */
  | { status: 'skip'; reason: string }
  | { status: 'unparsed'; reason: string; auth: AuthResult }
  | { status: 'quarantine'; reason: string; auth: AuthResult };

/** Письмо под ярлыком чеков: отправитель и подлинность, затем разбор. */
export function processReceiptEmail(msg: EmailInput & { subject: string }): ReceiptOutcome {
  const auth = parseAuthResults(topAuthResultsHeader(msg.raw), GRAB_ORG_DOMAIN);
  if (address(msg.from) !== GRAB_SENDER) return { status: 'quarantine', reason: 'чужой отправитель', auth };
  if (!isTrusted(auth)) return { status: 'quarantine', reason: 'не прошла проверка DKIM/DMARC', auth };
  if (msg.subject.trim() !== GRAB_RECEIPT_SUBJECT) return { status: 'skip', reason: 'не чек' };
  const r = parseGrabReceipt(msg.html, { gmailMessageId: msg.id });
  return r.ok ? { status: 'receipt', receipt: r.receipt } : { status: 'unparsed', reason: r.error, auth };
}

/** `0123456789` → `****6789`. */
export const maskAccount = (a: string | undefined): string => (a ? '****' + a.slice(-4) : '-');

const authStr = (a: AuthResult): string =>
  (['dkim', 'spf', 'dmarc'] as const).map((k) => `${k}=${a[k] ? 'pass' : 'no'}`).join(' ');

/** Строка для лога: без имён и полных номеров счётов. */
export function formatLog(id: string, o: Outcome): string {
  if (o.status !== 'parsed') return `${o.status} msg=${id} причина: ${o.reason} (${authStr(o.auth)})`;
  const t = o.txn;
  return (
    `parsed msg=${id} order=${t.orderNumber} ${t.occurredAtLocal} ${t.amount} ${t.currency} fee=${t.feeAmount} ` +
    `kind=${t.kind} debit=${maskAccount(t.debitAccount)} credit=${maskAccount(t.creditAccount)} (${authStr(t.auth)})`
  );
}
