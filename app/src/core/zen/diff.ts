// Запросы и ответы POST /v8/diff/. Сам HTTP-вызов — в слое Apps Script.
import type { ZenDiffRequest, ZenTransaction } from '../types';
import type { ExistingTxn } from './dedup';

export const ZEN_DIFF_URL = 'https://api.zenmoney.ru/v8/diff/';

export interface ZenMeta {
  serverTimestamp: number;
  userId: number;
  instruments: Record<string, number>;
  /** UUID неархивных счетов. */
  accountIds: Set<string>;
}

interface RawDiff {
  serverTimestamp?: number;
  user?: { id: number; parent: number | null }[];
  instrument?: { id: number; shortTitle: string }[];
  account?: { id: string; archive?: boolean }[];
  transaction?: ExistingTxn[];
}

/** Запрос на чтение всего: нужен и для метаданных, и для проверки дублей. */
export const fullFetchRequest = (now: number): ZenDiffRequest => ({ currentClientTimestamp: now, serverTimestamp: 0 });

export function readMeta(resp: unknown): ZenMeta {
  const d = resp as RawDiff;
  const parents = (d.user ?? []).filter((u) => u.parent === null);
  if (parents.length !== 1) throw new Error(`ожидался один родительский пользователь, найдено ${parents.length}`);
  if (typeof d.serverTimestamp !== 'number') throw new Error('в ответе нет serverTimestamp');
  const instruments: Record<string, number> = {};
  for (const i of d.instrument ?? []) if (instruments[i.shortTitle] === undefined) instruments[i.shortTitle] = i.id;
  return {
    serverTimestamp: d.serverTimestamp,
    userId: parents[0]!.id,
    instruments,
    accountIds: new Set((d.account ?? []).filter((a) => !a.archive).map((a) => a.id)),
  };
}

export const readTransactions = (resp: unknown): ExistingTxn[] => (resp as RawDiff).transaction ?? [];

/** Запрос на запись. Поля deletion нет и не будет: удалять из Дзен-мани скрипт не должен. */
export function writeRequest(serverTimestamp: number, txns: ZenTransaction[], now: number): ZenDiffRequest {
  return { currentClientTimestamp: now, serverTimestamp, transaction: txns };
}

/** id, которых нет среди операций в ответе на запись (сервер возвращает изменённые объекты). */
export function missingAfterWrite(resp: unknown, ids: string[]): string[] {
  const got = new Set(readTransactions(resp).map((t) => t.id));
  return ids.filter((id) => !got.has(id));
}
