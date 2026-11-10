import { describe, expect, it } from 'vitest';
import {
  addStats,
  buildRunMessage,
  buildSummary,
  emptyDay,
  fmtAmount,
  throttle,
  txnLine,
  type MsgEvent,
} from '../src/core/notify';
import type { ParsedBankTxn } from '../src/core/types';

const t = (over: Partial<ParsedBankTxn> = {}): ParsedBankTxn => ({
  source: 'vcb-email',
  emailType: 'transfer_receipt',
  gmailMessageId: 'm1',
  orderNumber: '00000000001',
  occurredAtLocal: '2026-11-07T16:45:00+07:00',
  dateLocal: '2026-11-07',
  amount: 3084912,
  currency: 'VND',
  feeAmount: 0,
  debitAccount: '0000000851',
  creditAccount: '111111119540',
  beneficiaryName: 'SECRET NAME',
  remitter: 'OWNER NAME',
  details: 'SECRET NAME transfer',
  kind: 'expense',
  auth: { dkim: true, spf: true, dmarc: true },
  ...over,
});

describe('форматирование', () => {
  it('сумма с пробелами', () => {
    expect([fmtAmount(0), fmtAmount(999), fmtAmount(1000), fmtAmount(3084912)]).toEqual(['0', '999', '1 000', '3 084 912']);
  });
  it('строка операции: без имён, счёт замаскирован', () => {
    expect(txnLine(t(), 'Коммуналка')).toBe('07.11 −3 084 912 VND · Коммуналка · ****0851');
    expect(txnLine(t({ kind: 'income', creditAccount: '2222224723' }))).toBe('07.11 +3 084 912 VND · без категории · ****4723');
    expect(txnLine(t({ kind: 'transfer', creditAccount: '2222224723', feeAmount: 3300 }))).toBe(
      '07.11 ⇄ 3 084 912 VND (+ комиссия 3 300) · без категории · ****0851 → ****4723',
    );
    expect(txnLine(t())).not.toMatch(/SECRET|OWNER/);
  });
});

describe('сообщение по запуску', () => {
  const written: MsgEvent = { kind: 'written', msgId: 'a', line: '07.11 −1 000 VND · Еда · ****0851' };
  const dup: MsgEvent = { kind: 'duplicate', msgId: 'b', line: '07.11 −2 000 VND · без категории · ****0851', reason: 'похожая ручная операция 2026-11-07 на 2000 (id x)' };
  it('нечего сообщать → null', () => {
    expect(buildRunMessage([], [], true)).toBeNull();
    expect(buildRunMessage([written], [], false)).toBeNull();
  });
  it('только успех', () => {
    expect(buildRunMessage([written], [], true)).toBe('Дзен-мани\n✅ 07.11 −1 000 VND · Еда · ****0851');
  });
  it('проблема: заголовок, причина и ссылка на письмо', () => {
    expect(buildRunMessage([written, dup], [], false)).toBe(
      [
        '⚠️ Дзен-мани: нужно внимание',
        '👯 07.11 −2 000 VND · без категории · ****0851',
        '   похоже на ручной ввод — не записано',
        '   похожая ручная операция 2026-11-07 на 2000 (id x)',
        '   https://mail.google.com/mail/u/0/#all/b',
      ].join('\n'),
    );
  });
  it('неразобранное письмо без строки операции и системная проблема', () => {
    const msg = buildRunMessage([{ kind: 'unparsed', msgId: 'c', reason: 'не разобрана комиссия' }], ['Дзен-мани: 401'], true)!;
    expect(msg.split('\n')).toEqual([
      '⚠️ Дзен-мани: нужно внимание',
      '❗ Дзен-мани: 401',
      '❓ не разобрано',
      '   не разобрана комиссия',
      '   https://mail.google.com/mail/u/0/#all/c',
    ]);
  });
});

describe('статистика и сводка', () => {
  const txns = new Map([
    ['a', t({ amount: 1000, feeAmount: 100 })],
    ['b', t({ kind: 'income', amount: 500 })],
    ['c', t({ amount: 7 })],
  ]);
  it('считает события и суммы только записанного', () => {
    const s = addStats({}, '2026-11-10', [
      { kind: 'written', msgId: 'a' },
      { kind: 'written', msgId: 'b' },
      { kind: 'duplicate', msgId: 'c' },
    ], txns);
    expect(s['2026-11-10']).toEqual({ ...emptyDay(), written: 2, duplicate: 1, outcome: { VND: 1100 }, income: { VND: 500 } });
  });
  it('копит за день и хранит 14 дней', () => {
    let s = {};
    for (let d = 1; d <= 16; d++) s = addStats(s, `2026-11-${String(d).padStart(2, '0')}`, [{ kind: 'error', msgId: 'x' }], txns);
    s = addStats(s, '2026-11-16', [{ kind: 'error', msgId: 'x' }], txns);
    expect(Object.keys(s)).toHaveLength(14);
    expect((s as Record<string, { error: number }>)['2026-11-16']!.error).toBe(2);
  });
  it('сводка: суммы, ожидающие ярлыки, тишина от банка', () => {
    const d = { ...emptyDay(), written: 2, duplicate: 1, outcome: { VND: 3084912 } };
    expect(buildSummary('2026-11-10', d, { 'zen/duplicate': 1, 'zen/error': 0 }, '2026-11-10', true).split('\n')).toEqual([
      '📊 Дзен-мани · 10.11',
      'Записано операций: 2 · расходы 3 084 912 VND',
      'За день: похоже на ручной ввод — не записано: 1',
      'Ждут проверки в Gmail: zen/duplicate — 1 (после проверки снять ярлык)',
    ]);
    expect(buildSummary('2026-11-14', undefined, {}, '2026-11-10', false)).toBe(
      '📊 Дзен-мани · 14.11 · режим dry-run\nЗаписано операций: 0\n⚠️ Писем от банка не было 4 дн. (последнее 10.11) — проверить фильтр и пересылку.',
    );
  });
});

describe('антиспам', () => {
  it('один раз в 6 часов на ключ, старые ключи чистятся', () => {
    let r = throttle({ old: 0 }, 'zen-401', 1_000_000);
    expect(r.send).toBe(true);
    expect(Object.keys(r.state)).toEqual(['zen-401']);
    expect(throttle(r.state, 'zen-401', 1_000_000 + 3600).send).toBe(false);
    expect(throttle(r.state, 'other', 1_000_000 + 3600).send).toBe(true);
    r = throttle(r.state, 'zen-401', 1_000_000 + 6 * 3600);
    expect(r.send).toBe(true);
  });
});
