// Общие типы ядра. Ядро не использует API Node и Apps Script.

export type TxnKind = 'expense' | 'transfer';

export type VcbEmailType =
  | 'transfer_receipt' // перевод по счёту
  | 'transfer_account_card' // перевод «на счёт/карту» (QR, другой набор полей)
  | 'bill_payment' // оплата счёта, QR Pay
  | 'card_transfer'; // перевод на карту

export interface EmailAuth {
  dkim: boolean;
  spf: boolean;
  dmarc: boolean;
}

export interface ParsedBankTxn {
  source: 'vcb-email';
  emailType: VcbEmailType;
  orderNumber: string; // ключ идемпотентности
  occurredAtLocal: string; // "2026-11-08T10:57:00+07:00"
  dateLocal: string; // "2026-11-08", локальная вьетнамская дата
  amount: number;
  currency: 'VND';
  feeAmount: number;
  debitAccount: string;
  creditAccount?: string;
  remitter?: string;
  beneficiaryName?: string;
  beneficiaryBank?: string;
  billCode?: string;
  details?: string;
}

export interface ZenTransaction {
  id: string; // UUIDv5 от `vcb:<orderNumber>`
  changed: number;
  created: number;
  user: number;
  deleted: boolean;
  hold: boolean | null;
  viewed: boolean;
  incomeInstrument: number;
  incomeAccount: string;
  income: number;
  outcomeInstrument: number;
  outcomeAccount: string;
  outcome: number;
  tag: string[] | null;
  merchant: string | null;
  payee: string | null;
  originalPayee: string | null;
  comment: string | null;
  date: string; // yyyy-MM-dd
  reminderMarker: string | null;
  opIncome: number | null;
  opIncomeInstrument: number | null;
  opOutcome: number | null;
  opOutcomeInstrument: number | null;
  latitude: number | null;
  longitude: number | null;
  // поля из фактического ответа API (в wiki не описаны)
  incomeBankID: string | null;
  outcomeBankID: string | null;
  qrCode: string | null;
  source: string | null;
  viewed: boolean;
}

export interface ZenTag {
  id: string;
  title: string;
  parent: string | null;
}

export interface ZenAccount {
  id: string;
  title: string;
  instrument: number;
}

export interface ZenInstrument {
  id: number;
  shortTitle: string;
}

export interface ZenUser {
  id: number;
  parent: number | null;
}

export interface ZenDiffResponse {
  serverTimestamp: number;
  instrument?: ZenInstrument[];
  account?: ZenAccount[];
  tag?: ZenTag[];
  user?: ZenUser[];
  transaction?: ZenTransaction[];
}

export interface ZenDiffRequest {
  currentClientTimestamp: number;
  serverTimestamp: number;
  forceFetch?: string[];
  transaction?: ZenTransaction[];
  // deletion намеренно не поддерживается
}

/** Правило из app/config/category-rules.json. */
export interface CategoryRule {
  id: string;
  tag: string | null;
  match: string[];
  confidence?: string;
  merchant?: string;
  amountMin?: number;
  amountMax?: number;
  needsReview?: boolean;
}

export interface AmountHint {
  id: string;
  tag: string;
  min?: number;
  exact?: number;
}

export interface PersonHeuristic {
  id: string;
  tag: string;
  amountMin: number;
  amountMax: number;
  multipleOf: number;
}

export interface CategoryRules {
  rules: CategoryRule[];
  amountHints?: AmountHint[];
  personHeuristics?: PersonHeuristic[];
  neverAssign?: string[];
  feeTag?: string;
}

/** Личное правило по получателю (Script Properties, не в git). */
export interface LocalRule {
  beneficiary: string;
  bank?: string;
  tag?: string | null;
  transferTo?: string; // название счёта в Дзен-мани
  needsReview?: boolean;
}

export interface AccountsConfig {
  /** номер счёта VCB → UUID счёта в Дзен-мани */
  accounts: Record<string, string>;
}
