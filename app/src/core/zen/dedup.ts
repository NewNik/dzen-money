// Что делать с каждой операцией: создать, пропустить как уже записанную или как ручной дубль.
import type { ZenTransaction } from '../types';
import { uuidv5 } from '../uuid';

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
  /**
   * Удалённую операцию записать заново по явной просьбе (свойство REDO). Дзен-мани удалённое по id не восстанавливает,
   * поэтому id новый: UUIDv5 от `vcb:<order>:r<N>`.
   */
  | { action: 'restore'; txn: ZenTransaction }
  /**
   * Похожая операция, внесённая вручную, без маркера [vcb:…], дата ±1 день.
   * `fuzzy: false` — тот же счёт (для расхода — любой из своих) и та же сумма.
   * `fuzzy: true` — сумма отличается в пределах допуска: вручную суммы округляют и опечатываются.
   */
  | { action: 'manual-duplicate'; txn: ZenTransaction; match: ExistingTxn; fuzzy: boolean };

/** `…[vcb:123]` → `vcb:123`; `[vcb:123:fee]` → `vcb:123:fee`. */
const markerName = (comment: string | null): string | undefined => /\[(vcb:[^\]]+)\]/.exec(comment ?? '')?.[1];

const DAY = 86_400_000;
const dayDiff = (a: string, b: string): number => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

/** Допуск для неточного совпадения: 3 % суммы, но не меньше 1000. */
export const fuzzyTolerance = (amount: number): number => Math.max(1000, amount * 0.03);

/**
 * Разница сумм между кандидатом и ручной операцией по совпадающей стороне; `undefined` — стороны не совпали.
 * Расход сверяется по любому из своих счетов (`own`): его могли записать на счёт второго владельца.
 */
function sideDiff(c: ZenTransaction, e: ExistingTxn, own: ReadonlySet<string>): number | undefined {
  const isExpense = c.outcome > 0 && c.income === 0;
  const sameOut = e.outcomeAccount === c.outcomeAccount || (isExpense && own.has(c.outcomeAccount) && own.has(e.outcomeAccount));
  if (c.outcome > 0 && e.outcome > 0 && sameOut) return Math.abs(e.outcome - c.outcome);
  if (c.income > 0 && e.income > 0 && e.incomeAccount === c.incomeAccount) return Math.abs(e.income - c.income);
  return undefined;
}

/**
 * `redo` — id операций, которые человек явно попросил записать заново: удалённая восстанавливается,
 * проверка на ручной дубль пропускается. Существующую (не удалённую) операцию redo не трогает.
 */
export function planWrites(
  candidates: ZenTransaction[],
  existing: readonly ExistingTxn[],
  redo: ReadonlySet<string> = new Set(),
  /** UUID своих счетов из ACCOUNTS — для сверки расхода, записанного на другой свой счёт. */
  ownAccounts: ReadonlySet<string> = new Set(),
): Decision[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  // Живые операции скрипта по метке: после REDO у операции другой id, но метка та же.
  const aliveMarkers = new Set(existing.filter((e) => !e.deleted).map((e) => markerName(e.comment)).filter(Boolean));
  const manual = existing.filter((e) => !e.deleted && !(e.comment ?? '').includes('[vcb:'));
  const used = new Set<string>(); // одна ручная операция закрывает не больше одной из писем
  const amountOf = (t: ZenTransaction): number => t.outcome || t.income;
  const findManual = (txn: ZenTransaction, fuzzy: boolean): ExistingTxn | undefined => {
    let best: { m: ExistingTxn; diff: number } | undefined;
    for (const m of manual) {
      if (used.has(m.id) || dayDiff(m.date, txn.date) > 1) continue;
      const diff = sideDiff(txn, m, ownAccounts);
      if (diff === undefined || (fuzzy ? diff === 0 || diff > fuzzyTolerance(amountOf(txn)) : diff !== 0)) continue;
      if (!best || diff < best.diff) best = { m, diff };
    }
    return best?.m;
  };
  // Первый проход: решения без неточных совпадений. Точные совпадения по всей пачке занимают ручные операции раньше неточных.
  const first = candidates.map((txn): Decision | null => {
    const e = byId.get(txn.id);
    const name = markerName(txn.comment);
    if ((e && !e.deleted) || (name && aliveMarkers.has(name))) return { action: 'exists', txn };
    if (e) {
      if (!redo.has(txn.id) || !name) return { action: 'deleted', txn };
      let n = 1;
      while (byId.has(uuidv5(`${name}:r${n}`))) n++;
      return { action: 'restore', txn: { ...txn, id: uuidv5(`${name}:r${n}`) } };
    }
    if (redo.has(txn.id)) return { action: 'create', txn };
    const match = findManual(txn, false);
    if (match) {
      used.add(match.id);
      return { action: 'manual-duplicate', txn, match, fuzzy: false };
    }
    return null;
  });
  // Второй проход: для оставшихся — неточное совпадение. Комиссии не сверяем: вручную их отдельно не вносят.
  return first.map((d, i): Decision => {
    if (d) return d;
    const txn = candidates[i]!;
    const match = /:fee\]/.test(txn.comment ?? '') ? undefined : findManual(txn, true);
    if (match) {
      used.add(match.id);
      return { action: 'manual-duplicate', txn, match, fuzzy: true };
    }
    return { action: 'create', txn };
  });
}
