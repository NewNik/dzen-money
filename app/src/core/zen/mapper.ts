// Построение операций Дзен-мани из разобранного письма.
import { categorize, type Categorization } from '../rules';
import { cleanBeneficiary } from '../text';
import { vcbTxnId } from '../uuid';
import type {
  AccountsConfig, CategoryRules, LocalRule, ParsedBankTxn, ZenAccount, ZenDiffResponse, ZenTag, ZenTransaction,
} from '../types';

export interface ZenContext {
  userId: number;
  vndId: number;
  tags: ZenTag[];
  accounts: ZenAccount[];
  /** операции за последние дни — для поиска дублей */
  recent: ZenTransaction[];
}

export function buildContext(diff: ZenDiffResponse): ZenContext {
  const vnd = (diff.instrument ?? []).find((i) => i.shortTitle === 'VND');
  if (!vnd) throw new Error('в ответе Дзен-мани нет валюты VND');
  const users = diff.user ?? [];
  const user = users.find((u) => u.parent === null) ?? users[0];
  if (!user) throw new Error('в ответе Дзен-мани нет пользователя');
  return { userId: user.id, vndId: vnd.id, tags: diff.tag ?? [], accounts: diff.account ?? [], recent: diff.transaction ?? [] };
}

const trim = (s: string) => s.replace(/\s+/g, ' ').trim();

/** «Питание / Продукты» → id категории. Названия в Дзен-мани бывают с пробелом на конце. */
export function resolveTag(path: string, tags: ZenTag[]): string | undefined {
  const parts = path.split(' / ').map(trim);
  if (parts.length === 1) return tags.find((t) => t.parent === null && trim(t.title) === parts[0])?.id;
  const parent = tags.find((t) => t.parent === null && trim(t.title) === parts[0]);
  return parent && tags.find((t) => t.parent === parent.id && trim(t.title) === parts[1])?.id;
}

export function resolveAccount(title: string, accounts: ZenAccount[]): string | undefined {
  return accounts.find((a) => trim(a.title) === trim(title))?.id;
}

export const marker = (order: string, suffix = '') => `[vcb:${order}${suffix}]`;
const REVIEW = '[проверить]';

export type Outcome =
  | { action: 'create'; transactions: ZenTransaction[]; cat: Categorization }
  | { action: 'already'; reason: string }
  | { action: 'duplicate'; exact: boolean; existingId: string; diff: number }
  | { action: 'error'; reason: string };

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000;
}

/** Ищет операцию, внесённую вручную: тот же набор счетов, ±2 дня, сумма с допуском 3 % (минимум 1000). */
export function findManualDuplicate(
  txn: ParsedBankTxn, accountIds: Set<string>, recent: ZenTransaction[], claimed: Set<string>,
): { t: ZenTransaction; diff: number } | undefined {
  const tol = Math.max(1000, txn.amount * 0.03);
  let best: { t: ZenTransaction; diff: number; days: number } | undefined;
  for (const t of recent) {
    if (t.deleted || claimed.has(t.id) || !accountIds.has(t.outcomeAccount) || !(t.outcome > 0)) continue;
    if ((t.comment ?? '').includes('[vcb:')) continue;
    const days = dayDiff(t.date, txn.dateLocal);
    const diff = Math.abs(t.outcome - txn.amount);
    if (days > 2 || diff > tol) continue;
    if (diff > 0 && days > 1) continue;
    if (!best || diff < best.diff || (diff === best.diff && days < best.days)) best = { t, diff, days };
  }
  return best && { t: best.t, diff: best.diff };
}

export interface PlanInput {
  txn: ParsedBankTxn;
  ctx: ZenContext;
  accounts: AccountsConfig;
  rules: CategoryRules;
  local: LocalRule[];
  now: number; // unix-секунды
  /** id операций, уже занятых другими письмами этого запуска */
  claimed: Set<string>;
}

export function plan(input: PlanInput): Outcome {
  const { txn, ctx, accounts, rules, local, now, claimed } = input;
  const account = accounts.accounts[txn.debitAccount];
  if (!account) return { action: 'error', reason: 'счёт списания не задан в конфиге' };
  if (!ctx.accounts.some((a) => a.id === account)) return { action: 'error', reason: 'счёт из конфига не найден в Дзен-мани' };

  const id = vcbTxnId(txn.orderNumber);
  const mark = marker(txn.orderNumber);
  if (ctx.recent.some((t) => t.id === id || (t.comment ?? '').includes(mark))) return { action: 'already', reason: 'уже загружена' };

  const cat = categorize(txn, rules, local);
  const base = {
    changed: now, created: now, user: ctx.userId, deleted: false, hold: false, viewed: false,
    incomeInstrument: ctx.vndId, outcomeInstrument: ctx.vndId, date: txn.dateLocal,
    merchant: null, qrCode: null, source: null, incomeBankID: null, outcomeBankID: null, reminderMarker: null,
    opIncome: null, opIncomeInstrument: null, opOutcome: null, opOutcomeInstrument: null, latitude: null, longitude: null,
  };
  const transactions: ZenTransaction[] = [];

  if (cat.transferTo) {
    // Перевод между своими счетами: вторая сторона могла внести его вручную.
    const to = resolveAccount(cat.transferTo, ctx.accounts);
    if (!to) return { action: 'error', reason: 'счёт перевода не найден в Дзен-мани' };
    const dup = findManualDuplicate(txn, new Set([account]), ctx.recent, claimed);
    if (dup) {
      claimed.add(dup.t.id);
      return { action: 'duplicate', exact: dup.diff === 0, existingId: dup.t.id, diff: dup.diff };
    }
    transactions.push({
      ...base, id, outcomeAccount: account, outcome: txn.amount, incomeAccount: to, income: txn.amount,
      tag: null, payee: null, originalPayee: null, comment: mark,
    });
  } else {
    const all = new Set(Object.values(accounts.accounts));
    const dup = findManualDuplicate(txn, all, ctx.recent, claimed);
    if (dup) {
      claimed.add(dup.t.id);
      return { action: 'duplicate', exact: dup.diff === 0, existingId: dup.t.id, diff: dup.diff };
    }
    const tagId = cat.tag ? resolveTag(cat.tag, ctx.tags) : undefined;
    const details = txn.emailType === 'bill_payment' && txn.billCode ? `счёт ${txn.billCode}` : '';
    const comment = [cat.needsReview ? REVIEW : '', details, mark].filter(Boolean).join(' ');
    transactions.push({
      ...base, id, outcomeAccount: account, outcome: txn.amount, incomeAccount: account, income: 0,
      tag: tagId ? [tagId] : null,
      payee: cat.merchant ?? cleanBeneficiary(txn.beneficiaryName),
      originalPayee: txn.beneficiaryName,
      comment,
    });
  }

  if (txn.feeAmount > 0) {
    const feeTag = rules.feeTag ? resolveTag(rules.feeTag, ctx.tags) : undefined;
    transactions.push({
      ...base, id: vcbTxnId(txn.orderNumber, ':fee'), outcomeAccount: account, outcome: txn.feeAmount,
      incomeAccount: account, income: 0, tag: feeTag ? [feeTag] : null,
      payee: 'Vietcombank', originalPayee: 'Vietcombank', comment: `Комиссия ${marker(txn.orderNumber, ':fee')}`,
    });
  }
  return { action: 'create', transactions, cat };
}
