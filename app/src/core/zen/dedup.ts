// Что делать с каждой операцией: создать, пропустить как уже записанную или как ручной дубль.
import type { ZenTransaction } from '../types';

export type ExistingTxn = Pick<
  ZenTransaction,
  'id' | 'deleted' | 'date' | 'income' | 'outcome' | 'incomeAccount' | 'outcomeAccount' | 'comment'
>;

export type Decision =
  | { action: 'create'; txn: ZenTransaction }
  /** Операция с этим id уже есть. Повторно не отправляем, чтобы не затереть правки из приложения. */
  | { action: 'exists'; txn: ZenTransaction }
  /** Операцию с этим id удалили в приложении. Не воскрешаем. */
  | { action: 'deleted'; txn: ZenTransaction }
  /** Похожая операция, внесённая вручную: тот же счёт и сумма, дата ±1 день, без маркера [vcb:…]. */
  | { action: 'manual-duplicate'; txn: ZenTransaction; match: ExistingTxn };

const DAY = 86_400_000;
const dayDiff = (a: string, b: string): number => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

function sameSide(c: ZenTransaction, e: ExistingTxn): boolean {
  if (c.outcome > 0 && e.outcomeAccount === c.outcomeAccount && e.outcome === c.outcome) return true;
  if (c.income > 0 && e.incomeAccount === c.incomeAccount && e.income === c.income) return true;
  return false;
}

export function planWrites(candidates: ZenTransaction[], existing: readonly ExistingTxn[]): Decision[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const manual = existing.filter((e) => !e.deleted && !(e.comment ?? '').includes('[vcb:'));
  const used = new Set<string>(); // одна ручная операция закрывает не больше одной из писем
  return candidates.map((txn): Decision => {
    const e = byId.get(txn.id);
    if (e) return { action: e.deleted ? 'deleted' : 'exists', txn };
    const match = manual.find((m) => !used.has(m.id) && dayDiff(m.date, txn.date) <= 1 && sameSide(txn, m));
    if (match) {
      used.add(match.id);
      return { action: 'manual-duplicate', txn, match };
    }
    return { action: 'create', txn };
  });
}
