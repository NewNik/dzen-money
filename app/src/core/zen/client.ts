// Запросы к /v8/diff/. Транспорт (UrlFetchApp или fetch) передаётся снаружи.
import type { ZenDiffRequest, ZenDiffResponse, ZenTransaction } from '../types';

export const ZEN_DIFF_URL = 'https://api.zenmoney.ru/v8/diff/';

/** Чтение: справочники целиком и операции, изменённые за последние windowDays дней. */
export function readRequest(now: number, windowDays: number): ZenDiffRequest {
  return {
    currentClientTimestamp: now,
    serverTimestamp: now - windowDays * 86400,
    forceFetch: ['instrument', 'account', 'tag', 'user'],
  };
}

/** Запись новых операций. Удаления не отправляются никогда. */
export function writeRequest(now: number, transactions: ZenTransaction[]): ZenDiffRequest {
  if (transactions.some((t) => t.deleted)) throw new Error('попытка отправить удалённую операцию');
  return { currentClientTimestamp: now, serverTimestamp: now, transaction: transactions };
}

/** Последняя защита перед отправкой: в теле запроса не должно быть ключа deletion. */
export function serialize(req: ZenDiffRequest): string {
  if ('deletion' in (req as object)) throw new Error('deletion в запросе запрещён');
  return JSON.stringify(req);
}

export function parseResponse(status: number, body: string): ZenDiffResponse {
  if (status === 401) throw new Error('Дзен-мани: 401, токен недействителен');
  if (status < 200 || status >= 300) throw new Error(`Дзен-мани: HTTP ${status}`);
  const data = JSON.parse(body) as ZenDiffResponse;
  if (typeof data.serverTimestamp !== 'number') throw new Error('Дзен-мани: неожиданный ответ');
  return data;
}
