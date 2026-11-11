// Тексты уведомлений (Telegram) и дневная статистика. Без сети и GAS API.
// В сообщениях нет имён контрагентов и полных номеров счетов: сумма, категория, ****1234.
import { maskAccount } from './pipeline';
import type { ParsedBankTxn } from './types';

/** 3084912 → `3 084 912`. */
export const fmtAmount = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** `2026-11-07` → `07.11`. */
export const fmtDay = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** `07.11 −3 084 912 VND · Коммуналка · ****0851`. */
export function txnLine(t: ParsedBankTxn, category?: string): string {
  const sign = t.kind === 'income' ? '+' : t.kind === 'transfer' ? '⇄ ' : '−';
  const acc =
    t.kind === 'income' ? maskAccount(t.creditAccount)
    : t.kind === 'transfer' ? `${maskAccount(t.debitAccount)} → ${maskAccount(t.creditAccount)}`
    : maskAccount(t.debitAccount);
  const fee = t.feeAmount > 0 ? ` (+ комиссия ${fmtAmount(t.feeAmount)})` : '';
  return [`${fmtDay(t.dateLocal)} ${sign}${fmtAmount(t.amount)} ${t.currency}${fee}`, category ?? 'без категории', acc].join(' · ');
}

/** `чек Grab 10.11 · 245 000 VND · Доставка еды · <ресторан>`. Ресторан — название заведения, не имя человека. */
export function receiptLine(e: { source: string; dateLocal: string; amount: number; currency: string; note?: string }, category?: string): string {
  const src = e.source.charAt(0).toUpperCase() + e.source.slice(1);
  return [`чек ${src} ${fmtDay(e.dateLocal)}`, `${fmtAmount(e.amount)} ${e.currency}`, category, e.note].filter(Boolean).join(' · ');
}

export const gmailLink = (msgId: string): string => `https://mail.google.com/mail/u/0/#all/${msgId}`;

export type EventKind =
  | 'written'
  | 'dryrun'
  | 'duplicate'
  | 'unparsed'
  | 'quarantine'
  | 'error'
  /** чек подтвердил операцию скрипта */
  | 'receipt'
  /** чек совпал с ручной операцией — подсказка */
  | 'receiptHint'
  /** операция для чека не появилась */
  | 'receiptUnmatched'
  /** несколько операций с той же суммой — не угадываем */
  | 'receiptAmbiguous';

export interface MsgEvent {
  kind: EventKind;
  msgId: string;
  /** Описание операции (txnLine), если письмо разобрано. */
  line?: string;
  reason?: string;
}

const ICON: Record<EventKind, string> = {
  written: '✅',
  dryrun: '🧪',
  duplicate: '👯',
  unparsed: '❓',
  quarantine: '🚫',
  error: '❌',
  receipt: '🧾',
  receiptHint: '💡',
  receiptUnmatched: '🕳',
  receiptAmbiguous: '❓',
};
const TITLE: Record<EventKind, string> = {
  written: 'записано',
  dryrun: 'dry-run, не записано',
  duplicate: 'похоже на ручной ввод — не записано',
  unparsed: 'не разобрано',
  quarantine: 'карантин',
  error: 'ошибка',
  receipt: 'подтверждено чеком',
  receiptHint: 'чек совпал с ручной операцией — не правлю',
  receiptUnmatched: 'операция для чека не найдена',
  receiptAmbiguous: 'несколько операций с такой суммой — не угадываю',
};
const PROBLEMS: ReadonlySet<EventKind> = new Set<EventKind>(['duplicate', 'unparsed', 'quarantine', 'error', 'receiptAmbiguous']);

/**
 * Сообщение по итогам запуска или null, если писать не о чем.
 * `notifyAll` — сообщать и об успешных записях, иначе только о проблемах.
 */
export function buildRunMessage(events: readonly MsgEvent[], system: readonly string[], notifyAll: boolean): string | null {
  const shown = events.filter((e) => notifyAll || PROBLEMS.has(e.kind));
  if (!shown.length && !system.length) return null;
  const bad = system.length > 0 || shown.some((e) => PROBLEMS.has(e.kind));
  const out = [bad ? '⚠️ Дзен-мани: нужно внимание' : 'Дзен-мани'];
  for (const s of system) out.push(`❗ ${s}`);
  for (const e of shown) {
    const parts = [`${ICON[e.kind]} ${e.line ?? TITLE[e.kind]}`];
    if (e.line && e.kind !== 'written') parts.push(`   ${TITLE[e.kind]}`);
    if (e.reason) parts.push(`   ${e.reason}`);
    if (PROBLEMS.has(e.kind)) parts.push(`   ${gmailLink(e.msgId)}`);
    out.push(parts.join('\n'));
  }
  return truncate(out.join('\n'));
}

/** Лимит Telegram — 4096 символов. */
export const truncate = (s: string, max = 4000): string => (s.length <= max ? s : s.slice(0, max - 20) + '\n… (обрезано)');

// --- дневная статистика ---

export interface DayStats {
  written: number;
  dryrun: number;
  duplicate: number;
  unparsed: number;
  quarantine: number;
  error: number;
  receipt: number;
  receiptHint: number;
  receiptUnmatched: number;
  receiptAmbiguous: number;
  /** Сумма записанных расходов и доходов по валютам. */
  outcome: Record<string, number>;
  income: Record<string, number>;
}

export const emptyDay = (): DayStats => ({
  written: 0,
  dryrun: 0,
  duplicate: 0,
  unparsed: 0,
  quarantine: 0,
  error: 0,
  receipt: 0,
  receiptHint: 0,
  receiptUnmatched: 0,
  receiptAmbiguous: 0,
  outcome: {},
  income: {},
});

const KEEP_DAYS = 14;

/** Учесть события запуска. `txns` — разобранные письма по msgId (для сумм записанного). Хранит последние 14 дней. */
export function addStats(
  stats: Record<string, DayStats>,
  day: string,
  events: readonly MsgEvent[],
  txns: ReadonlyMap<string, ParsedBankTxn>,
): Record<string, DayStats> {
  const d = { ...emptyDay(), ...stats[day] };
  for (const e of events) {
    d[e.kind]++;
    const t = txns.get(e.msgId);
    if (e.kind !== 'written' || !t) continue;
    const add = (bucket: Record<string, number>) => (bucket[t.currency] = (bucket[t.currency] ?? 0) + t.amount + t.feeAmount);
    if (t.kind === 'expense') add(d.outcome);
    if (t.kind === 'income') add(d.income);
  }
  const out = { ...stats, [day]: d };
  for (const k of Object.keys(out).sort().slice(0, -KEEP_DAYS)) delete out[k];
  return out;
}

const DAY_MS = 86_400_000;
export const daysBetween = (fromIso: string, toIso: string): number => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);

const sums = (b: Record<string, number>): string =>
  Object.entries(b)
    .map(([cur, n]) => `${fmtAmount(n)} ${cur}`)
    .join(', ');

/**
 * Вечерняя сводка. `waiting` — сколько тредов висит под ярлыками, требующими внимания.
 * `lastBankDay` — день последнего обработанного письма банка: тишина 3+ дня — повод проверить фильтр.
 */
export function buildSummary(
  today: string,
  d: DayStats | undefined,
  waiting: Record<string, number>,
  lastBankDay: string | undefined,
  write: boolean,
): string {
  const s = d ?? emptyDay();
  const out = [`📊 Дзен-мани · ${fmtDay(today)}${write ? '' : ' · режим dry-run'}`];
  const spent = sums(s.outcome);
  const got = sums(s.income);
  out.push(`Записано операций: ${s.written}${spent ? ` · расходы ${spent}` : ''}${got ? ` · доходы ${got}` : ''}`);
  if (s.dryrun) out.push(`dry-run (не записано): ${s.dryrun}`);
  if (s.receipt) out.push(`Подтверждено чеками: ${s.receipt}`);
  const probs = (['duplicate', 'unparsed', 'quarantine', 'error'] as const).filter((k) => s[k]).map((k) => `${TITLE[k]}: ${s[k]}`);
  if (probs.length) out.push(`За день: ${probs.join('; ')}`);
  const wait = Object.entries(waiting).filter(([, n]) => n > 0);
  if (wait.length) out.push(`Ждут проверки в Gmail: ${wait.map(([l, n]) => `${l} — ${n}`).join(', ')} (после проверки снять ярлык)`);
  if (!lastBankDay) out.push('⚠️ Писем от банка ещё не было.');
  else {
    const n = daysBetween(lastBankDay, today);
    if (n >= 3) out.push(`⚠️ Писем от банка не было ${n} дн. (последнее ${fmtDay(lastBankDay)}) — проверить фильтр и пересылку.`);
  }
  return truncate(out.join('\n'));
}

// --- антиспам системных уведомлений ---

/** Разрешено ли слать уведомление с ключом `key`: не чаще раза в `hours` часов. Возвращает новое состояние. */
export function throttle(
  state: Record<string, number>,
  key: string,
  nowSec: number,
  hours = 6,
): { send: boolean; state: Record<string, number> } {
  const last = state[key];
  if (last !== undefined && nowSec - last < hours * 3600) return { send: false, state };
  const next: Record<string, number> = {};
  for (const [k, t] of Object.entries(state)) if (nowSec - t < 7 * 86400) next[k] = t; // чистим старше недели
  next[key] = nowSec;
  return { send: true, state: next };
}
