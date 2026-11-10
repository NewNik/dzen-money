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
  /** Название категории в Дзен-мани, как в приложении. */
  tag: string;
  /** Заменить получателя (например, «EVN» вместо «EVN Miền Trung»). */
  payee?: string;
}

export interface CompiledRule {
  rule: Rule;
  tagId: string;
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
    if (!rule || typeof rule.match !== 'string' || !rule.match.trim() || typeof rule.tag !== 'string') {
      errors.push(`${where}: нужны поля match и tag`);
      return;
    }
    const tagId = tagsByTitle[tagKey(rule.tag)];
    if (!tagId) {
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

/** Первое подходящее правило. Переводы между своими счетами не категоризируются. */
export function findRule(t: ParsedBankTxn, rules: readonly CompiledRule[]): CompiledRule | undefined {
  if (t.kind !== 'expense' && t.kind !== 'income') return undefined;
  const payee = foldText((t.kind === 'expense' ? t.beneficiaryName : t.remitter) ?? '');
  const details = foldText(t.details ?? '');
  return rules.find(({ rule, test }) => {
    const f = rule.field ?? 'any';
    return ((f === 'payee' || f === 'any') && payee !== '' && test(payee)) || ((f === 'details' || f === 'any') && details !== '' && test(details));
  });
}
