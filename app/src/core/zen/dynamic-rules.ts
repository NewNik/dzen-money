// Динамические правила: категории, которые человек оставил на операциях скрипта в приложении,
// становятся правилами для следующих операций. Хранилища нет — правила каждый запуск выводятся
// заново из выгрузки Дзен-мани. Решение — kb/decisions/0003.
//
// Три шага, каждый заменяем по отдельности:
//   1. observe — операции Дзен-мани → наблюдения «признак → категория»;
//   2. learn   — наблюдения → правила (политика: окно последних наблюдений, большинство);
//   3. compileDynamic — правила → CompiledRule для общего поиска `findRule`.
import type { ParsedBankTxn, ZenTransaction } from '../types';
import { hasEvidence, isScriptOp, untouched } from './evidence';
import { cleanDetails } from './mapper';
import { foldText, looksLikePerson, type CompiledRule } from './rules';

type Direction = 'expense' | 'income';

/** Признак операции, по которому запоминается категория. Новый признак — новый элемент `FEATURES`. */
export interface Feature {
  id: 'details' | 'payee';
  /** Нормализованное значение признака или `undefined`, если признак у операции пустой или бессмысленный. */
  key(text: string | undefined): string | undefined;
  /** Текст признака в разобранном письме. */
  fromEmail(t: ParsedBankTxn): string | undefined;
  /** Текст признака в операции Дзен-мани, записанной скриптом. */
  fromZen(t: ZenTransaction): string | undefined;
}

// Слова назначения платежа, которые ничего не говорят о покупке.
const NOISE = new Set([
  'chuyen', 'tien', 'khoan', 'thanh', 'toan', 'transfer', 'payment', 'pay', 'qr', 'ck', 'ct', 'tt', 'mbvcb', 'vcb',
  'cho', 'tu', 'den', 'ung', 'dung', 'giao', 'dich', 'ma', 'so', 'don', 'hang', 'order', 'bill', 'the', 'to', 'from',
]);

/**
 * Назначение платежа → ключ. Отбрасываются коды и номера (слова с цифрами), служебные слова и одиночные буквы;
 * ключ есть, только если осталось хотя бы два слова: `Tien nha thang 11` → `nha thang`, `H2R16P` → нет ключа.
 */
export function detailsKey(text: string | undefined): string | undefined {
  const words = foldText(text ?? '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !/\d/.test(w) && !NOISE.has(w));
  return words.length >= 2 ? words.join(' ') : undefined;
}

/** Имя получателя (для дохода — отправителя) → ключ: без регистра и диакритик. */
export function payeeKey(text: string | undefined): string | undefined {
  return foldText(text ?? '') || undefined;
}

/** Метки `[vcb:…]`, `[grab:…]` в комментарии — не часть назначения платежа. */
const stripMarkers = (comment: string | null): string => (comment ?? '').replace(/\[[a-z]+:[^\]]*\]/g, ' ');

/** Признаки по убыванию точности: назначение платежа описывает покупку, получатель — только место. */
export const FEATURES: readonly Feature[] = [
  {
    id: 'details',
    key: detailsKey,
    // Автотекст «<имя отправителя> transfer» в комментарий не попадает — и здесь его тоже нет.
    fromEmail: (t) => cleanDetails(t.details, t.remitter),
    fromZen: (t) => stripMarkers(t.comment),
  },
  {
    id: 'payee',
    key: payeeKey,
    fromEmail: (t) => (t.kind === 'income' ? t.remitter : t.beneficiaryName),
    fromZen: (t) => t.originalPayee ?? t.payee ?? undefined,
  },
];

/** Приводит имя получателя к единому: у сети магазинов бывает несколько написаний. */
export type Canon = (payee: string) => string;

/**
 * Единое имя — из обычных правил с полем `payee` (`CTCP TM BACH HOA XANH` и `CTY CP BACH HOA XANH` → `Bach Hoa Xanh`).
 * Условия по сумме не учитываются: имя от суммы не зависит.
 */
export function canonFromRules(rules: readonly CompiledRule[]): Canon {
  const renames = rules.filter((r) => r.rule.payee && r.rule.field !== 'details' && !r.matches);
  return (payee) => {
    const folded = foldText(payee);
    return renames.find((r) => r.test(folded))?.rule.payee ?? payee;
  };
}

const featureKey = (f: Feature, text: string | undefined, canon: Canon | undefined): string | undefined =>
  f.key(f.id === 'payee' && text && canon ? canon(text) : text);

/** Одно наблюдение: человек видел операцию с таким признаком и оставил на ней эту категорию. */
export interface Observation {
  direction: Direction;
  feature: Feature['id'];
  key: string;
  tagId: string;
  /** Порядок наблюдений: дата операции, затем время записи. */
  date: string;
  created: number;
}

/**
 * Наблюдения из выгрузки Дзен-мани. Учитываются только операции, за которые отвечает человек:
 *  - записана скриптом (метка `[vcb:…]`), не комиссия, не перевод между своими счетами, не удалена;
 *  - после записи её открывали или правили в приложении (`changed − created > 60 с`);
 *  - категория стоит;
 *  - имя получателя приводится к единому (`canon`), чтобы правки по разным написаниям одной сети складывались;
 *  - категорию не ставил чек (`[grab:…]`): там источник сильнее и получатель — случайный курьер.
 */
export function observe(txns: readonly ZenTransaction[], ownAccounts: ReadonlySet<string>, canon?: Canon): Observation[] {
  const out: Observation[] = [];
  for (const t of txns) {
    if (t.deleted || !isScriptOp(t) || hasEvidence(t) || untouched(t)) continue;
    if (t.outcomeAccount !== t.incomeAccount || !ownAccounts.has(t.outcomeAccount)) continue;
    const tagId = t.tag?.[0];
    if (!tagId) continue;
    const direction: Direction = t.outcome > 0 ? 'expense' : 'income';
    for (const f of FEATURES) {
      const key = featureKey(f, f.fromZen(t), canon);
      if (key) out.push({ direction, feature: f.id, key, tagId, date: t.date, created: t.created });
    }
  }
  return out;
}

export interface DynamicRule {
  direction: Direction;
  feature: Feature['id'];
  key: string;
  tagId: string;
  /** Сколько наблюдений в окне за эту категорию и сколько в окне всего. */
  votes: number;
  window: number;
  /** Дата последнего наблюдения. */
  lastDate: string;
}

export interface LearnPolicy {
  /** Сколько последних наблюдений по признаку учитывать. */
  window: number;
}
export const DEFAULT_POLICY: LearnPolicy = { window: 3 };

/**
 * Наблюдения → правила. По каждому признаку берутся последние `window` наблюдений, побеждает категория
 * с большинством; при равенстве — самая свежая. Одна правка уже даёт правило, а разовое исключение
 * у магазина со смешанными покупками привычную категорию не сбивает.
 */
export function learn(observations: readonly Observation[], policy: LearnPolicy = DEFAULT_POLICY): DynamicRule[] {
  const groups = new Map<string, Observation[]>();
  for (const o of observations) {
    const id = `${o.direction}|${o.feature}|${o.key}`;
    const g = groups.get(id);
    if (g) g.push(o);
    else groups.set(id, [o]);
  }
  const out: DynamicRule[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created - b.created));
    const recent = g.slice(-policy.window);
    const votes = new Map<string, number>();
    for (const o of recent) votes.set(o.tagId, (votes.get(o.tagId) ?? 0) + 1);
    const last = recent[recent.length - 1]!;
    let best = last.tagId; // при равенстве остаётся самая свежая
    for (const [tagId, n] of votes) if (n > votes.get(best)!) best = tagId;
    out.push({
      direction: last.direction,
      feature: last.feature,
      key: last.key,
      tagId: best,
      votes: votes.get(best)!,
      window: recent.length,
      lastDate: last.date,
    });
  }
  return out;
}

/**
 * Правила → вид для `findRule`. Порядок — как в `FEATURES`: сначала по назначению платежа, затем по получателю.
 * Категории, которой в Дзен-мани уже нет, правило не достаётся.
 */
export function compileDynamic(rules: readonly DynamicRule[], tagTitles: Record<string, string>, canon?: Canon): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const f of FEATURES) {
    for (const r of rules) {
      const title = tagTitles[r.tagId];
      if (r.feature !== f.id || title === undefined) continue;
      out.push({
        origin: 'dynamic',
        rule: { match: r.key, field: f.id, tag: title },
        tagId: r.tagId,
        test: () => false,
        matches: (t) => t.kind === r.direction && featureKey(f, f.fromEmail(t), canon) === r.key,
      });
    }
  }
  return out;
}

/** Всё вместе: выгрузка Дзен-мани → правила для `findRule`. */
export function dynamicRules(
  txns: readonly ZenTransaction[],
  ownAccounts: ReadonlySet<string>,
  tagTitles: Record<string, string>,
  canon?: Canon,
  policy: LearnPolicy = DEFAULT_POLICY,
): { learned: DynamicRule[]; rules: CompiledRule[] } {
  const learned = learn(observe(txns, ownAccounts, canon), policy);
  return { learned, rules: compileDynamic(learned, tagTitles, canon) };
}

/** Ключи единых имён из обычных правил (`bach hoa xanh`, `grab`) — это заведомо не люди. */
export const canonKeys = (rules: readonly CompiledRule[]): Set<string> =>
  new Set(rules.flatMap((r) => (r.rule.payee ? [foldText(r.rule.payee)] : [])));

/**
 * Строка для журнала. Имя человека сокращается до инициалов: `nguyen van test` → `n. v. t.`;
 * `shops` — ключи, которые сокращать не нужно (`canonKeys`).
 */
export function formatDynamicRule(r: DynamicRule, tagTitles: Record<string, string>, shops: ReadonlySet<string> = new Set()): string {
  const key =
    r.feature === 'payee' && !shops.has(r.key) && looksLikePerson(r.key)
      ? r.key.split(' ').map((w) => w.charAt(0) + '.').join(' ')
      : r.key;
  const what = r.feature === 'details' ? 'назначение' : r.direction === 'income' ? 'отправитель' : 'получатель';
  return `${what} «${key}» → ${tagTitles[r.tagId] ?? r.tagId} (${r.votes} из ${r.window}, последняя ${r.lastDate})`;
}
