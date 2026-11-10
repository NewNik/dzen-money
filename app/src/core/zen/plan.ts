// Решение по пачке разобранных писем: что создать в Дзен-мани и с каким итогом пометить письмо.
import type { ParsedBankTxn, ZenTransaction } from '../types';
import { planWrites, type Decision, type ExistingTxn } from './dedup';
import { toZenTransactions, type ZenContext } from './mapper';

export type MsgStatus =
  /** есть операции к созданию */
  | 'create'
  /** всё уже записано (или удалено в приложении) — делать нечего */
  | 'done'
  /** похоже на ручной ввод — не создаём, нужна проверка человеком */
  | 'duplicate'
  /** не удалось построить операцию (счёт, валюта) */
  | 'unmapped';

export interface MsgPlan {
  msgId: string;
  status: MsgStatus;
  reason?: string;
  decisions: Decision[];
  /** Что отправить (только при status = create). */
  creates: ZenTransaction[];
}

export function planMessages(
  items: { msgId: string; txn: ParsedBankTxn }[],
  ctx: ZenContext,
  accountIds: ReadonlySet<string>,
  existing: readonly ExistingTxn[],
): MsgPlan[] {
  const mapped: { msgId: string; txns: ZenTransaction[] }[] = [];
  const plans = new Map<string, MsgPlan>();
  for (const { msgId, txn } of items) {
    const r = toZenTransactions(txn, ctx);
    if (!r.ok) {
      plans.set(msgId, { msgId, status: 'unmapped', reason: r.reason, decisions: [], creates: [] });
      continue;
    }
    const unknownAcc = r.txns.flatMap((t) => [t.incomeAccount, t.outcomeAccount]).find((a) => !accountIds.has(a));
    if (unknownAcc) {
      plans.set(msgId, {
        msgId,
        status: 'unmapped',
        reason: `счёт ${unknownAcc} из ACCOUNTS не найден в Дзен-мани (или в архиве)`,
        decisions: [],
        creates: [],
      });
      continue;
    }
    mapped.push({ msgId, txns: r.txns });
  }

  // Дубли проверяем по всей пачке сразу: одна ручная операция не закроет два письма.
  const decisions = planWrites(mapped.flatMap((m) => m.txns), existing);
  let k = 0;
  for (const m of mapped) {
    const ds = decisions.slice(k, (k += m.txns.length));
    const dup = ds.find((d) => d.action === 'manual-duplicate');
    if (dup && dup.action === 'manual-duplicate') {
      const amount = dup.match.outcome || dup.match.income;
      plans.set(m.msgId, {
        msgId: m.msgId,
        status: 'duplicate',
        reason: `похожая ручная операция ${dup.match.date} на ${amount} (id ${dup.match.id})`,
        decisions: ds,
        creates: [],
      });
      continue;
    }
    const creates = ds.filter((d) => d.action === 'create').map((d) => d.txn);
    plans.set(m.msgId, { msgId: m.msgId, status: creates.length ? 'create' : 'done', decisions: ds, creates });
  }
  return items.map((i) => plans.get(i.msgId)!);
}

/** Длинные цепочки цифр (номера счетов в назначении платежа) → `****1234`; Order Number в маркере не трогаем. */
const maskLongDigits = (s: string): string => s.replace(/(?<!vcb:)\b\d{8,}/g, (d) => '****' + d.slice(-4));

/** Строка для лога об одной операции. `tagTitles` — id категории → название. */
export function formatDecision(d: Decision, tagTitles: Record<string, string> = {}): string {
  const t = d.txn;
  const sum = t.outcome > 0 && t.income > 0 ? `${t.outcome}→${t.income}` : t.outcome > 0 ? `-${t.outcome}` : `+${t.income}`;
  const acc =
    t.outcomeAccount === t.incomeAccount
      ? t.outcomeAccount.slice(0, 8)
      : `${t.outcomeAccount.slice(0, 8)}→${t.incomeAccount.slice(0, 8)}`;
  const tag = t.tag?.length ? t.tag.map((id) => tagTitles[id] ?? id).join(',') : '-';
  return `${d.action} id=${t.id} ${t.date} ${sum} acc=${acc} tag=${tag} comment="${maskLongDigits(t.comment ?? '')}"`;
}
