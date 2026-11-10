// Обработка пачки писем: чистая функция, без Gmail и сети.
import { parseAuthResults, parseVcbEmail, VCB_SENDER, VcbParseError } from './banks/vcb';
import { cleanBeneficiary, maskAccount } from './text';
import { plan, type ZenContext } from './zen/mapper';
import type { AccountsConfig, CategoryRules, LocalRule, ZenTransaction } from './types';

export interface RawEmail {
  id: string; // id сообщения Gmail
  from: string;
  authResults: string;
  html: string;
}

export type Status = 'create' | 'already' | 'duplicate' | 'duplicate_fuzzy' | 'unparsed' | 'error';

export interface EmailResult {
  id: string;
  status: Status;
  /** строка для лога; номера счетов замаскированы */
  line: string;
  transactions: ZenTransaction[];
}

export interface BatchInput {
  emails: RawEmail[];
  ctx: ZenContext;
  accounts: AccountsConfig;
  rules: CategoryRules;
  local: LocalRule[];
  now: number;
}

const fmt = (n: number) => n.toLocaleString('en-US');

export function processBatch(input: BatchInput): EmailResult[] {
  const claimed = new Set<string>();
  const seenOrders = new Set<string>();
  return input.emails.map((e): EmailResult => {
    const fail = (status: Status, line: string): EmailResult => ({ id: e.id, status, line, transactions: [] });
    if (!e.from.toLowerCase().includes(VCB_SENDER)) return fail('error', 'отправитель не Vietcombank');
    const auth = parseAuthResults(e.authResults);
    if (!auth.dkim || !auth.spf || !auth.dmarc) return fail('error', 'письмо не прошло DKIM/SPF/DMARC');
    let txn;
    try {
      txn = parseVcbEmail(e.html);
    } catch (err) {
      if (err instanceof VcbParseError) return fail('unparsed', err.message);
      throw err;
    }
    const head = `${txn.dateLocal} ${fmt(txn.amount)} VND ${maskAccount(txn.debitAccount)} → ${cleanBeneficiary(txn.beneficiaryName)}`;
    if (seenOrders.has(txn.orderNumber)) return fail('already', `${head}: повтор в пачке`);
    seenOrders.add(txn.orderNumber);
    const out = plan({ txn, ctx: input.ctx, accounts: input.accounts, rules: input.rules, local: input.local, now: input.now, claimed });
    switch (out.action) {
      case 'error':
        return fail('error', `${head}: ${out.reason}`);
      case 'already':
        return fail('already', `${head}: ${out.reason}`);
      case 'duplicate':
        return out.exact
          ? fail('duplicate', `${head}: уже внесена вручную`)
          : fail('duplicate_fuzzy', `${head}: похожа на внесённую вручную, разница ${fmt(out.diff)} VND`);
      case 'create': {
        const what = out.cat.transferTo ? `перевод на «${out.cat.transferTo}»` : out.cat.tag ?? 'без категории';
        const fee = out.transactions.length > 1 ? ', + комиссия' : '';
        return {
          id: e.id, status: 'create', transactions: out.transactions,
          line: `${head}: ${what} (${out.cat.ruleId}${out.cat.needsReview ? ', проверить' : ''})${fee}`,
        };
      }
    }
  });
}
