// Правила категорий: текст письма (получатель, назначение) → категория Дзен-мани.
import type { ParsedBankTxn } from '../types';

export interface Rule {
  /**
   * Подстрока или `/регулярка/`. Сравнение без учёта регистра и вьетнамских диакритик:
   * регулярка применяется к тексту, приведённому `foldText` (`EVN Miền Trung` → `evn mien trung`).
   */
  match: string;
  /** Где искать: получатель/отправитель, назначение платежа или везде (по умолчанию). */
  field?: 'payee' | 'details' | 'any';
  /**
   * Название категории в Дзен-мани, как в приложении. `null` — категорию не ставить
   * (магазин со смешанными покупками, маркетплейс): правило только останавливает поиск и может подменить получателя.
   */
  tag: string | null;
  /** Заменить получателя (например, «EVN» вместо «EVN Miền Trung»). */
  payee?: string;
  /** Сумма не меньше (включительно). */
  amountMin?: number;
  /** Сумма строго меньше. */
  amountMax?: number;
  /** Сумма кратна этому числу. */
  multipleOf?: number;
  /** Только расход физлицу: в имени получателя нет признаков магазина или организации. */
  person?: boolean;
}

export interface CompiledRule {
  rule: Rule;
  /** `null` — правило без категории. */
  tagId: string | null;
  test: (s: string) => boolean;
}

/** `Miền Trung` → `mien trung`: NFD, без диакритик, đ → d, нижний регистр, схлопнутые пробелы. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ключ категории: название без краевых пробелов и регистра (в приложении бывают «Досуг »). */
export const tagKey = (title: string): string => title.trim().toLowerCase();

/**
 * Проверяет правила и находит id категорий. Ошибочные правила не ломают остальные,
 * а возвращаются списком для журнала.
 */
export function compileRules(
  rules: readonly Rule[],
  tagsByTitle: Record<string, string>,
): { rules: CompiledRule[]; errors: string[] } {
  const out: CompiledRule[] = [];
  const errors: string[] = [];
  rules.forEach((rule, i) => {
    const where = `правило ${i + 1} (${rule.match ?? '?'})`;
    if (!rule || typeof rule.match !== 'string' || !rule.match.trim() || (typeof rule.tag !== 'string' && rule.tag !== null)) {
      errors.push(`${where}: нужны поля match и tag`);
      return;
    }
    const tagId = rule.tag === null ? null : tagsByTitle[tagKey(rule.tag)];
    if (tagId === undefined) {
      errors.push(`${where}: нет категории «${rule.tag}» в Дзен-мани`);
      return;
    }
    let test: (s: string) => boolean;
    const re = /^\/(.+)\/$/.exec(rule.match);
    if (re) {
      try {
        const rx = new RegExp(re[1]!, 'i');
        test = (s) => rx.test(s);
      } catch {
        errors.push(`${where}: неверная регулярка`);
        return;
      }
    } else {
      const needle = foldText(rule.match);
      test = (s) => s.includes(needle);
    }
    out.push({ rule, tagId, test });
  });
  return { rules: out, errors };
}

// Слова, по которым получатель — магазин, организация или платёжный шлюз, а не физлицо.
const BUSINESS =
  /(^| )(ho kinh doanh|hkd|cong ty|cty|ct cp|ctcp|tnhh|jsc|shop|store|mart|market|tiem|nha thuoc|nha hang|quan|food|cafe|coffee|momo|payoo|baokim|vnpay|evn|vms)( |$)|_/;

/** Похоже ли имя получателя на физлицо. `HO KINH DOANH …`, `CONG TY …`, `PAYOO_…` — нет. */
export function looksLikePerson(name: string | undefined): boolean {
  const n = foldText(name ?? '');
  return n !== '' && !BUSINESS.test(n);
}

function conditionsOk(rule: Rule, t: ParsedBankTxn): boolean {
  if (rule.amountMin !== undefined && t.amount < rule.amountMin) return false;
  if (rule.amountMax !== undefined && t.amount >= rule.amountMax) return false;
  if (rule.multipleOf !== undefined && t.amount % rule.multipleOf !== 0) return false;
  if (rule.person && !(t.kind === 'expense' && looksLikePerson(t.beneficiaryName))) return false;
  return true;
}

/** Первое подходящее правило. Переводы между своими счетами не категоризируются. */
export function findRule(t: ParsedBankTxn, rules: readonly CompiledRule[]): CompiledRule | undefined {
  if (t.kind !== 'expense' && t.kind !== 'income') return undefined;
  const payee = foldText((t.kind === 'expense' ? t.beneficiaryName : t.remitter) ?? '');
  const details = foldText(t.details ?? '');
  return rules.find(({ rule, test }) => {
    if (!conditionsOk(rule, t)) return false;
    const f = rule.field ?? 'any';
    return ((f === 'payee' || f === 'any') && payee !== '' && test(payee)) || ((f === 'details' || f === 'any') && details !== '' && test(details));
  });
}
