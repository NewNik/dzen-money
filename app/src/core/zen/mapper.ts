// Разобранное письмо → операции Дзен-мани. Без сети и GAS API.
import type { ParsedBankTxn, ZenTransaction } from '../types';
import { vcbTxnId } from '../uuid';
import { findRule, type CompiledRule } from './rules';

export interface ZenContext {
  /** Номер счёта VCB (только цифры) → UUID счёта в Дзен-мани. */
  accounts: Record<string, string>;
  /** id пользователя, на которого пишутся операции (родительский в семейном аккаунте). */
  userId: number;
  /** shortTitle валюты → id инструмента. */
  instruments: Record<string, number>;
  /** Текущее время, секунды Unix. */
  now: number;
  /** Правила категорий; без совпадения категория не ставится (её может угадать сам Дзен-мани). */
  rules?: readonly CompiledRule[];
}

export type MapResult = { ok: true; txns: ZenTransaction[] } | { ok: false; reason: string };

/** Маркер в комментарии: по нему видно, что операция записана скриптом, а не вручную. */
export const marker = (orderNumber: string, fee = false): string => `[vcb:${orderNumber}${fee ? ':fee' : ''}]`;

function blank(ctx: ZenContext): Omit<ZenTransaction, 'id' | 'incomeInstrument' | 'outcomeInstrument' | 'incomeAccount' | 'outcomeAccount' | 'income' | 'outcome' | 'date'> {
  return {
    changed: ctx.now,
    created: ctx.now,
    user: ctx.userId,
    deleted: false,
    hold: null,
    tag: null,
    merchant: null,
    payee: null,
    originalPayee: null,
    comment: null,
    reminderMarker: null,
    opIncome: null,
    opIncomeInstrument: null,
    opOutcome: null,
    opOutcomeInstrument: null,
    latitude: null,
    longitude: null,
    incomeBankID: null,
    outcomeBankID: null,
    qrCode: null,
    source: null,
    viewed: false, // новая операция подсвечивается в приложении как непросмотренная
  };
}

const withMarker = (text: string | undefined, m: string): string => (text ? `${text} ${m}` : m);

const norm = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Назначение платежа для комментария. Если назначение не ввели, VCB подставляет «<имя отправителя> transfer» —
 * такой автотекст не несёт смысла и содержит имя, его отбрасываем.
 */
export function cleanDetails(details: string | undefined, remitter: string | undefined): string | undefined {
  if (!details) return undefined;
  if (remitter && norm(details) === `${norm(remitter)} transfer`) return undefined;
  return details;
}

export function toZenTransactions(t: ParsedBankTxn, ctx: ZenContext): MapResult {
  const instrument = ctx.instruments[t.currency];
  if (instrument === undefined) return { ok: false, reason: `нет валюты ${t.currency} в Дзен-мани` };
  const debit = t.debitAccount ? ctx.accounts[t.debitAccount] : undefined;
  const credit = t.creditAccount ? ctx.accounts[t.creditAccount] : undefined;

  let outcomeAccount: string;
  let incomeAccount: string;
  let outcome = 0;
  let income = 0;
  let payee: string | null = null;
  switch (t.kind) {
    case 'expense':
      if (!debit) return { ok: false, reason: 'счёт списания не найден в ACCOUNTS' };
      outcomeAccount = incomeAccount = debit;
      outcome = t.amount;
      payee = t.beneficiaryName ?? null;
      break;
    case 'income':
      if (!credit) return { ok: false, reason: 'счёт зачисления не найден в ACCOUNTS' };
      outcomeAccount = incomeAccount = credit;
      income = t.amount;
      payee = t.remitter ?? null;
      break;
    case 'transfer':
      if (!debit || !credit) return { ok: false, reason: 'счета перевода не найдены в ACCOUNTS' };
      outcomeAccount = debit;
      incomeAccount = credit;
      outcome = income = t.amount;
      break;
    default:
      return { ok: false, reason: 'ни один счёт из письма не указан в ACCOUNTS' };
  }

  const rule = findRule(t, ctx.rules ?? []);
  const main: ZenTransaction = {
    ...blank(ctx),
    tag: rule ? [rule.tagId] : null,
    id: vcbTxnId(t.orderNumber),
    incomeInstrument: instrument,
    incomeAccount,
    income,
    outcomeInstrument: instrument,
    outcomeAccount,
    outcome,
    payee: rule?.rule.payee ?? payee,
    originalPayee: payee,
    comment: withMarker(cleanDetails(t.details, t.remitter), marker(t.orderNumber)),
    date: t.dateLocal,
  };
  const txns = [main];

  // Комиссию платит отправитель — отдельный расход с его счёта.
  if (t.feeAmount > 0) {
    if (!debit) return { ok: false, reason: 'комиссия, но счёт списания не найден в ACCOUNTS' };
    txns.push({
      ...blank(ctx),
      id: vcbTxnId(t.orderNumber, true),
      incomeInstrument: instrument,
      incomeAccount: debit,
      income: 0,
      outcomeInstrument: instrument,
      outcomeAccount: debit,
      outcome: t.feeAmount,
      payee: 'Vietcombank',
      originalPayee: null,
      comment: withMarker('Комиссия за перевод', marker(t.orderNumber, true)),
      date: t.dateLocal,
    });
  }
  return { ok: true, txns };
}
