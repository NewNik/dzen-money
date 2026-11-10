export type TxnKind = 'expense' | 'income' | 'transfer' | 'unknown';

export interface ParsedBankTxn {
  source: 'vcb-email';
  emailType:
    | 'transfer_receipt'
    | 'incoming_transfer'
    | 'card_payment'
    | 'cash_withdrawal'
    | 'balance_change'
    | 'qr_payment'
    | 'unknown';
  gmailMessageId: string;
  orderNumber: string; // ключ идемпотентности
  occurredAtLocal: string; // "2026-11-08T10:57:00+07:00"
  dateLocal: string; // "2026-11-08"
  amount: number;
  currency: string;
  feeAmount: number;
  debitAccount?: string;
  creditAccount?: string;
  remitter?: string;
  beneficiaryName?: string;
  beneficiaryBank?: string;
  billCode?: string; // код счёта/клиента в письме об оплате счёта
  details?: string;
  kind: TxnKind;
  auth: { dkim: boolean; spf: boolean; dmarc: boolean };
}

export interface ZenTransaction {
  id: string; // UUIDv5 от `vcb:<orderNumber>`
  changed: number;
  created: number;
  user: number;
  deleted: boolean;
  hold: boolean | null;
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

export interface ZenDiffRequest {
  currentClientTimestamp: number;
  serverTimestamp: number;
  forceFetch?: string[];
  transaction?: ZenTransaction[];
  // deletion намеренно не поддерживается
}
