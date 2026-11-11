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
   * `fuzzy: true` — сумма записана по памяти (см. `inexactMatch`); `why` — какое именно совпадение.
   */
  | { action: 'manual-duplicate'; txn: ZenTransaction; match: ExistingTxn; fuzzy: boolean; why?: InexactKind };

/** `…[vcb:123]` → `vcb:123`; `[vcb:123:fee]` → `vcb:123:fee`. */
const markerName = (comment: string | null): string | undefined => /\[(vcb:[^\]]+)\]/.exec(comment ?? '')?.[1];

const DAY = 86_400_000;
const dayDiff = (a: string, b: string): number => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

export type InexactKind = 'round-up' | 'first-digits' | 'typo';

const INEXACT_TEXT: Record<InexactKind, string> = {
  'round-up': 'сумма округлена вверх',
  'first-digits': 'совпадают первые цифры',
  typo: 'похоже на опечатку в сумме',
};
export const inexactText = (k: InexactKind): string => INEXACT_TEXT[k];

/** Больше чем на столько при округлении не прибавляют: 267 000 → 270 000 да, 285 420 → 290 000 нет. */
const ROUND_UP_MAX = 3000;

/** Единицы, до которых округляют в уме: 100, 500, 1000, 5000, 10 000, 50 000, … */
const UNITS: number[] = [];
for (let p = 100; p <= 10_000_000; p *= 10) UNITS.push(p, p * 5);

/**
 * Могли ли записать `manual`, округлив в уме `bank` вверх.
 *
 * Человек округляет, когда у суммы есть «неровный» разряд: 267 → 270, 119 600 → 120 000.
 * Записанная сумма должна быть ровнее настоящей — ближайшим сверху кратным единицы округления.
 * 203 000 → 206 000 не подходит: 206 ничуть не ровнее, чем 203, такого округления не бывает.
 *
 *  - Хвост меньше тысячи отбрасывают вверх всегда: 29 400 → 30 000.
 *  - Тысячи и крупнее округляют вверх, только если до ровного числа не дальше половины единицы
 *    и не больше 3000: 267 → 270 да, 262 → 270 нет (скорее скажут 260 или 265), 285 420 → 290 000 нет.
 *  - От суммы должны остаться хотя бы две значащие цифры: 267 → 270 да, 67 → 70 нет —
 *    мелкие суммы помнят точно, а соседние цены (33 и 35 тысяч) встречаются слишком часто.
 *    Для округления до «пятёрок» порог строже: 114 → 115 да, 74 → 75 нет.
 */
export function isRoundedUp(bank: number, manual: number): boolean {
  if (manual <= bank) return false;
  for (const unit of UNITS) {
    if (bank % unit === 0 || manual % unit !== 0) continue;
    if (manual !== Math.ceil(bank / unit) * unit) continue;
    if (unit <= 1000) return true;
    const isFive = String(unit)[0] === '5';
    const over = manual - bank;
    if (over <= ROUND_UP_MAX && over <= unit / 2 && manual / unit >= (isFive ? 20 : 10)) return true;
  }
  return false;
}

/** «Точно не помню, но первые цифры такие»: первые цифры те же (не меньше трёх либо все до тысяч), хвост — нули. */
function isFirstDigits(bank: number, manual: number): boolean {
  for (const unit of UNITS) {
    if (bank % unit === 0 || manual % unit !== 0 || String(unit)[0] === '5') continue;
    if (unit > 1000 && bank < unit * 100) continue;
    const down = Math.floor(bank / unit) * unit;
    if (down > 0 && manual === down) return true;
  }
  return false;
}

/** Опечатка: число той же длины, первые три цифры те же, отличается одна цифра или переставлены две соседние. */
function isTypo(bank: number, manual: number): boolean {
  const b = String(bank);
  const m = String(manual);
  if (b.length !== m.length || b.length < 5 || b.slice(0, 3) !== m.slice(0, 3)) return false;
  const diff: number[] = [];
  for (let i = 0; i < b.length; i++) if (b[i] !== m[i]) diff.push(i);
  if (diff.length === 1) return true;
  return diff.length === 2 && diff[1] === diff[0]! + 1 && b[diff[0]!] === m[diff[1]!] && b[diff[1]!] === m[diff[0]!];
}

/**
 * Сумма из письма банка `bank` и сумма, внесённая вручную по памяти, `manual`.
 *  - `round-up` — округление вверх (см. `isRoundedUp`), для любых сумм;
 *  - `first-digits` и `typo` — только когда сумма банка некруглая (не кратна 1000): круглую сумму
 *    помнят точно, и другая круглая сумма рядом — это другая покупка.
 */
export function inexactMatch(bank: number, manual: number): InexactKind | undefined {
  if (!Number.isInteger(bank) || !Number.isInteger(manual) || bank <= 0 || manual <= 0 || bank === manual) return undefined;
  if (isRoundedUp(bank, manual)) return 'round-up';
  if (bank % 1000 === 0) return undefined;
  if (isFirstDigits(bank, manual)) return 'first-digits';
  if (isTypo(bank, manual)) return 'typo';
  return undefined;
}

const KIND_RANK: Record<InexactKind, number> = { 'round-up': 0, 'first-digits': 1, typo: 2 };

/**
 * Сумма ручной операции по стороне, совпадающей с кандидатом; `undefined` — стороны не совпали.
 * Расход сверяется по любому из своих счетов (`own`): его могли записать на счёт второго владельца.
 */
function sideAmount(c: ZenTransaction, e: ExistingTxn, own: ReadonlySet<string>): number | undefined {
  const isExpense = c.outcome > 0 && c.income === 0;
  const sameOut = e.outcomeAccount === c.outcomeAccount || (isExpense && own.has(c.outcomeAccount) && own.has(e.outcomeAccount));
  if (c.outcome > 0 && e.outcome > 0 && sameOut) return e.outcome;
  if (c.income > 0 && e.income > 0 && e.incomeAccount === c.incomeAccount) return e.income;
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
  const findExact = (txn: ZenTransaction): ExistingTxn | undefined =>
    manual.find((m) => !used.has(m.id) && dayDiff(m.date, txn.date) <= 1 && sideAmount(txn, m, ownAccounts) === amountOf(txn));
  const findInexact = (txn: ZenTransaction): { m: ExistingTxn; why: InexactKind } | undefined => {
    let best: { m: ExistingTxn; why: InexactKind; diff: number } | undefined;
    for (const m of manual) {
      if (used.has(m.id) || dayDiff(m.date, txn.date) > 1) continue;
      const amount = sideAmount(txn, m, ownAccounts);
      const why = amount === undefined ? undefined : inexactMatch(amountOf(txn), amount);
      if (amount === undefined || !why) continue;
      const diff = Math.abs(amount - amountOf(txn));
      const better = !best || KIND_RANK[why] < KIND_RANK[best.why] || (why === best.why && diff < best.diff);
      if (better) best = { m, why, diff };
    }
    return best;
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
    const match = findExact(txn);
    if (match) {
      used.add(match.id);
      return { action: 'manual-duplicate', txn, match, fuzzy: false };
    }
    return null;
  });
  // Второй проход: для оставшихся — сумма, записанная по памяти. Комиссии не сверяем: вручную их отдельно не вносят.
  return first.map((d, i): Decision => {
    if (d) return d;
    const txn = candidates[i]!;
    const found = /:fee\]/.test(txn.comment ?? '') ? undefined : findInexact(txn);
    if (found) {
      used.add(found.m.id);
      return { action: 'manual-duplicate', txn, match: found.m, fuzzy: true, why: found.why };
    }
    return { action: 'create', txn };
  });
}
