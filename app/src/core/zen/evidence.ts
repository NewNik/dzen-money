// Сверка «подтверждений» (чек Grab, позже — заказ Shopee) с операциями Дзен-мани.
// Подтверждение не создаёт операцию: оно уточняет категорию и комментарий операции, записанной по письму банка.
// Порядок прихода не важен: подтверждение ждёт, пока операция не появится. Решение — kb/decisions/0002.
import type { GrabReceipt } from '../receipts/grab/e-receipt';
import type { ZenTransaction } from '../types';
import { looksLikePerson, tagKey } from './rules';

export interface Evidence {
  /** Источник: `grab`. Метка в комментарии — `[<source>:<id>]`. */
  source: string;
  id: string;
  msgId: string;
  /** Дата подтверждения (UTC+7) — от неё считается срок ожидания. */
  dateLocal: string;
  /** Допустимые даты операции. */
  dates: string[];
  amount: number;
  currency: string;
  /** Название категории в Дзен-мани. */
  tagTitle: string;
  /** Что дописать в комментарий (ресторан). */
  note?: string;
  /** Операция скрипта должна быть переводом физлицу (курьеру). */
  personOnly: boolean;
}

const nextDay = (iso: string): string => new Date(Date.parse(iso) + 86_400_000).toISOString().slice(0, 10);

/** Чек доставки еды → подтверждение. Поездки пока не сверяются (один образец, пары в учёте нет). */
export function grabEvidence(r: GrabReceipt): Evidence | null {
  if (r.kind !== 'food') return null;
  // Время в чеке — время заказа; курьеру платят через 20–40 минут, после 23:00 это может быть уже следующий день.
  const late = r.occurredAtLocal !== undefined && Number(r.occurredAtLocal.slice(11, 13)) >= 23;
  return {
    source: 'grab',
    id: r.orderId,
    msgId: r.gmailMessageId,
    dateLocal: r.dateLocal,
    dates: late ? [r.dateLocal, nextDay(r.dateLocal)] : [r.dateLocal],
    amount: r.amount,
    currency: r.currency,
    tagTitle: 'Доставка еды',
    note: r.merchant,
    personOnly: true,
  };
}

export const evidenceMarker = (e: Pick<Evidence, 'source' | 'id'>): string => `[${e.source}:${e.id}]`;

export interface ReconcileContext {
  /** UUID своих счетов из ACCOUNTS. */
  ownAccounts: ReadonlySet<string>;
  instruments: Record<string, number>;
  /** Ключ названия категории (`tagKey`) → id. */
  tagsByTitle: Record<string, string>;
  /** Категории, которые скрипт ставит сам по эвристике «перевод физлицу»: их подтверждение вправе заменить. */
  heuristicTagIds: ReadonlySet<string>;
  /** Текущее время, секунды Unix. */
  now: number;
  /** Сегодня, UTC+7. */
  today: string;
  /** Сколько дней подтверждение ждёт операцию. */
  waitDays?: number;
}

export type EvidenceOutcome =
  /** Операция уточнена. `target` — создаётся в этом запуске или уже записана. `keptTag` — id категории, которую не тронули. */
  | { status: 'applied'; ev: Evidence; target: 'create' | 'existing'; txn: ZenTransaction; keptTag?: string }
  /** Метка этого подтверждения уже стоит на операции. */
  | { status: 'already'; ev: Evidence }
  /** Совпала операция, внесённая вручную, — не правим, только сообщаем. */
  | { status: 'manual'; ev: Evidence; match: ZenTransaction }
  /** Несколько операций скрипта с той же суммой и датой — не угадываем. */
  | { status: 'ambiguous'; ev: Evidence; count: number }
  | { status: 'waiting'; ev: Evidence }
  /** Операция не появилась за `waitDays` дней. */
  | { status: 'expired'; ev: Evidence }
  /** В Дзен-мани нет категории с таким названием. */
  | { status: 'no-tag'; ev: Evidence };

const isScriptOp = (t: ZenTransaction): boolean => /\[vcb:[^\]]+\]/.test(t.comment ?? '') && !/\[vcb:[^\]]+:fee\]/.test(t.comment ?? '');
/** На операции уже стоит метка какого-то подтверждения (`[grab:…]`). */
const hasEvidence = (t: ZenTransaction): boolean => /\[(?!vcb:)[a-z]+:[^\]]+\]/.test(t.comment ?? '');
/** Человек не менял операцию: сервер сам правит её в первую секунду (автокатегория), всё позже — правка из приложения. */
const untouched = (t: ZenTransaction): boolean => t.changed - t.created <= 60;

const DAY = 86_400_000;

/**
 * `creates` — операции, которые будут записаны в этом запуске; `existing` — всё, что уже есть в Дзен-мани.
 * Возвращает `creates` в том же порядке (уточнённые), `updates` — уже записанные операции к повторной отправке.
 *
 * Границы правок:
 *  1. правятся только операции скрипта (метка `[vcb:…]`), ручные — никогда;
 *  2. категория меняется, если она пустая, поставлена скриптом по эвристике или операцию не трогал человек;
 *     иначе категория остаётся, дописывается только комментарий;
 *  3. одна операция — одно подтверждение, повтор по метке `[grab:…]` ничего не меняет.
 */
export function reconcile(
  evidences: readonly Evidence[],
  creates: readonly ZenTransaction[],
  existing: readonly ZenTransaction[],
  ctx: ReconcileContext,
): { outcomes: EvidenceOutcome[]; creates: ZenTransaction[]; updates: ZenTransaction[] } {
  const outCreates = [...creates];
  const alive = existing.filter((t) => !t.deleted);
  const updates: ZenTransaction[] = [];
  const used = new Set<string>();

  const outcomes = evidences.map((ev): EvidenceOutcome => {
    const mark = evidenceMarker(ev);
    if ([...outCreates, ...alive].some((t) => (t.comment ?? '').includes(mark))) return { status: 'already', ev };
    const tagId = ctx.tagsByTitle[tagKey(ev.tagTitle)];
    if (tagId === undefined) return { status: 'no-tag', ev };

    const instrument = ctx.instruments[ev.currency];
    const fits = (t: ZenTransaction): boolean =>
      !used.has(t.id) &&
      t.outcome === ev.amount &&
      t.income === 0 &&
      t.outcomeAccount === t.incomeAccount &&
      ctx.ownAccounts.has(t.outcomeAccount) &&
      t.outcomeInstrument === instrument &&
      ev.dates.includes(t.date);
    const scriptFits = (t: ZenTransaction): boolean =>
      fits(t) && isScriptOp(t) && !hasEvidence(t) && (!ev.personOnly || looksLikePerson(t.originalPayee ?? t.payee ?? undefined));

    const newIdx = outCreates.flatMap((t, i) => (scriptFits(t) ? [i] : []));
    const old = alive.filter(scriptFits);
    if (newIdx.length + old.length > 1) return { status: 'ambiguous', ev, count: newIdx.length + old.length };

    if (newIdx.length + old.length === 1) {
      const target = newIdx.length ? 'create' : 'existing';
      const op = newIdx.length ? outCreates[newIdx[0]!]! : old[0]!;
      const current = op.tag?.[0];
      const mayRetag =
        current === undefined || ctx.heuristicTagIds.has(current) || (target === 'existing' && untouched(op));
      const txn: ZenTransaction = {
        ...op,
        tag: mayRetag ? [tagId] : op.tag,
        comment: [op.comment, ev.note, mark].filter(Boolean).join(' '),
        ...(target === 'existing' ? { changed: ctx.now } : {}),
      };
      used.add(op.id);
      if (target === 'create') outCreates[newIdx[0]!] = txn;
      else updates.push(txn);
      return { status: 'applied', ev, target, txn, ...(!mayRetag && current !== tagId ? { keptTag: current } : {}) };
    }

    const manual = alive.find((t) => fits(t) && !(t.comment ?? '').includes('[vcb:'));
    if (manual) {
      used.add(manual.id);
      return { status: 'manual', ev, match: manual };
    }
    const age = Math.round((Date.parse(ctx.today) - Date.parse(ev.dateLocal)) / DAY);
    return { status: age >= (ctx.waitDays ?? 3) ? 'expired' : 'waiting', ev };
  });
  return { outcomes, creates: outCreates, updates };
}
