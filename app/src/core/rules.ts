// Определение категории. Порядок шагов и обоснование: kb/category-rules.md.
import { cleanBeneficiary, normalize } from './text';
import type { CategoryRules, LocalRule, ParsedBankTxn } from './types';

export interface Categorization {
  /** путь категории «Родитель / Подкатегория» или null — категорию не ставить */
  tag: string | null;
  /** название счёта-получателя, если это перевод между своими счетами */
  transferTo?: string;
  merchant?: string;
  ruleId: string;
  step: 'local' | 'keyword' | 'person' | 'amount' | 'none';
  needsReview: boolean;
}

// Слова, по которым получатель — организация или магазин, а не физлицо.
const BUSINESS = /(^| )(ho kinh doanh|hkd|cong ty|cty|ct cp|ctcp|tnhh|jsc|shop|store|mart|market|tiem|nha thuoc|nha hang|quan|food|cafe|coffee|momo|payoo|baokim|vnpay|evn|vms)( |$)|_/;

export function looksLikePerson(name: string): boolean {
  return !BUSINESS.test(normalize(name));
}

const cache = new Map<string, RegExp>();
function pattern(p: string): RegExp {
  let re = cache.get(p);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${p})`, 'iu');
    cache.set(p, re);
  }
  return re;
}

export function findLocalRule(txn: ParsedBankTxn, local: LocalRule[]): LocalRule | undefined {
  const name = normalize(cleanBeneficiary(txn.beneficiaryName));
  const bank = normalize(txn.beneficiaryBank ?? '');
  return local.find((r) => normalize(r.beneficiary) === name && (!r.bank || bank.includes(normalize(r.bank))));
}

export function categorize(txn: ParsedBankTxn, rules: CategoryRules, local: LocalRule[] = []): Categorization {
  const never = new Set(rules.neverAssign ?? []);
  const allowed = (tag: string | null | undefined): tag is string => !!tag && !never.has(tag);

  // Шаг 1. Личное правило по получателю.
  const lr = findLocalRule(txn, local);
  if (lr) {
    if (lr.transferTo) return { tag: null, transferTo: lr.transferTo, ruleId: 'local-transfer', step: 'local', needsReview: false };
    if (allowed(lr.tag)) return { tag: lr.tag, ruleId: 'local', step: 'local', needsReview: !!lr.needsReview };
    if (lr.tag === null || lr.needsReview) return { tag: null, ruleId: 'local-review', step: 'local', needsReview: true };
  }

  // Шаг 2. Ключевые слова в имени получателя. Назначение платежа в письмах VCB смысла не несёт.
  const text = normalize(txn.beneficiaryName);
  for (const r of rules.rules) {
    if (r.amountMin !== undefined && txn.amount < r.amountMin) continue;
    if (r.amountMax !== undefined && txn.amount >= r.amountMax) continue;
    if (!r.match.some((p) => pattern(p).test(text))) continue;
    const tag = allowed(r.tag) ? r.tag : null;
    return {
      tag,
      merchant: r.merchant,
      ruleId: r.id,
      step: 'keyword',
      needsReview: tag === null || !!r.needsReview || r.confidence !== 'high',
    };
  }

  // Шаг 2а. Физлицо без личного правила: по сумме похоже на курьера.
  if (looksLikePerson(txn.beneficiaryName)) {
    for (const h of rules.personHeuristics ?? []) {
      if (txn.amount >= h.amountMin && txn.amount < h.amountMax && txn.amount % h.multipleOf === 0 && allowed(h.tag)) {
        return { tag: h.tag, ruleId: h.id, step: 'person', needsReview: true };
      }
    }
  }

  // Шаг 5. Подсказка по сумме.
  for (const h of rules.amountHints ?? []) {
    const hit = h.exact !== undefined ? txn.amount === h.exact : h.min !== undefined && txn.amount >= h.min;
    if (hit && allowed(h.tag)) return { tag: h.tag, ruleId: h.id, step: 'amount', needsReview: true };
  }

  return { tag: null, ruleId: 'none', step: 'none', needsReview: true };
}
