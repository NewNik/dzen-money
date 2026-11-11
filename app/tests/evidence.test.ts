import { describe, expect, it } from 'vitest';
import type { GrabReceipt } from '../src/core/receipts/grab/e-receipt';
import type { ZenTransaction } from '../src/core/types';
import { grabEvidence, reconcile, type Evidence, type ReconcileContext } from '../src/core/zen/evidence';

const ACC_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ACC_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const TAG_DELIVERY = 'tag-delivery';
const TAG_GROCERY = 'tag-grocery';
const NOW = 1_800_000_000;

const ctx: ReconcileContext = {
  ownAccounts: new Set([ACC_A, ACC_B]),
  instruments: { VND: 11902 },
  tagsByTitle: { 'доставка еды': TAG_DELIVERY, продукты: TAG_GROCERY },
  heuristicTagIds: new Set([TAG_DELIVERY]),
  now: NOW,
  today: '2026-11-08',
};

const receipt = (over: Partial<GrabReceipt> = {}): GrabReceipt => ({
  source: 'grab-email',
  kind: 'food',
  service: 'GrabFood',
  gmailMessageId: 'r1',
  orderId: 'A-0TESTFOOD0001AV',
  occurredAtLocal: '2026-11-08T13:13:00+07:00',
  dateLocal: '2026-11-08',
  amount: 245000,
  currency: 'VND',
  paymentMethod: 'Cash',
  merchant: 'TEST KITCHEN',
  ...over,
});
const ev = (over: Partial<GrabReceipt> = {}): Evidence => grabEvidence(receipt(over))!;

const op = (over: Partial<ZenTransaction> = {}): ZenTransaction => ({
  id: 'op-1',
  changed: NOW - 1000,
  created: NOW - 1000,
  user: 100,
  deleted: false,
  hold: null,
  incomeInstrument: 11902,
  incomeAccount: ACC_A,
  income: 0,
  outcomeInstrument: 11902,
  outcomeAccount: ACC_A,
  outcome: 245000,
  tag: null,
  merchant: null,
  payee: 'NGUYEN VAN TEST',
  originalPayee: 'NGUYEN VAN TEST',
  comment: '[vcb:00000000001]',
  date: '2026-11-08',
  reminderMarker: null,
  opIncome: null,
  opIncomeInstrument: null,
  opOutcome: null,
  opOutcomeInstrument: null,
  latitude: null,
  longitude: null,
  incomeBankID: null,
  outcomeBankID: null,
  qrCode: null,
  source: null,
  viewed: false,
  ...over,
});

describe('grabEvidence', () => {
  it('чек еды → подтверждение «Доставка еды»', () => {
    expect(ev()).toMatchObject({ source: 'grab', id: 'A-0TESTFOOD0001AV', dates: ['2026-11-08'], amount: 245000, tagTitle: 'Доставка еды', note: 'TEST KITCHEN' });
  });
  it('заказ после 23:00 — операция может быть и следующим днём', () => {
    expect(ev({ occurredAtLocal: '2026-11-30T23:40:00+07:00', dateLocal: '2026-11-30' }).dates).toEqual(['2026-11-30', '2026-12-01']);
  });
  it('поездка не сверяется', () => {
    expect(grabEvidence(receipt({ kind: 'ride' }))).toBeNull();
  });
});

describe('reconcile: чек раньше письма банка', () => {
  it('операция этого запуска получает категорию и ресторан', () => {
    const r = reconcile([ev()], [op()], [], ctx);
    expect(r.outcomes[0]).toMatchObject({ status: 'applied', target: 'create' });
    expect(r.creates[0]).toMatchObject({ tag: [TAG_DELIVERY], comment: '[vcb:00000000001] TEST KITCHEN [grab:A-0TESTFOOD0001AV]', changed: NOW - 1000 });
    expect(r.updates).toEqual([]);
  });
  it('эвристическая категория заменяется, категория по личному правилу — нет', () => {
    const heur = reconcile([ev()], [op({ tag: [TAG_DELIVERY] })], [], ctx);
    expect(heur.creates[0]!.tag).toEqual([TAG_DELIVERY]);
    const own = reconcile([ev()], [op({ tag: [TAG_GROCERY] })], [], ctx);
    expect(own.outcomes[0]).toMatchObject({ status: 'applied', keptTag: TAG_GROCERY });
    expect(own.creates[0]).toMatchObject({ tag: [TAG_GROCERY], comment: '[vcb:00000000001] TEST KITCHEN [grab:A-0TESTFOOD0001AV]' });
  });
  it('порядок и количество creates сохраняются', () => {
    const other = op({ id: 'op-0', outcome: 74000, comment: '[vcb:00000000000]' });
    const r = reconcile([ev()], [other, op()], [], ctx);
    expect(r.creates.map((t) => t.id)).toEqual(['op-0', 'op-1']);
    expect(r.creates[0]).toBe(other);
  });
});

describe('reconcile: чек позже письма банка', () => {
  it('записанная скриптом операция отправляется заново с новым changed', () => {
    const r = reconcile([ev()], [], [op()], ctx);
    expect(r.outcomes[0]).toMatchObject({ status: 'applied', target: 'existing' });
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0]).toMatchObject({ id: 'op-1', tag: [TAG_DELIVERY], changed: NOW, created: NOW - 1000, deleted: false });
  });
  it('автокатегория сервера (операцию не трогал человек) заменяется', () => {
    const r = reconcile([ev()], [], [op({ tag: [TAG_GROCERY], changed: NOW - 999 })], ctx);
    expect(r.updates[0]!.tag).toEqual([TAG_DELIVERY]);
  });
  it('категорию, изменённую человеком, не трогаем — только комментарий', () => {
    const r = reconcile([ev()], [], [op({ tag: [TAG_GROCERY], changed: NOW - 100 })], ctx);
    expect(r.outcomes[0]).toMatchObject({ status: 'applied', keptTag: TAG_GROCERY });
    expect(r.updates[0]).toMatchObject({ tag: [TAG_GROCERY], comment: '[vcb:00000000001] TEST KITCHEN [grab:A-0TESTFOOD0001AV]' });
  });
  it('пустая категория ставится, даже если операцию открывали в приложении', () => {
    const r = reconcile([ev()], [], [op({ changed: NOW - 100 })], ctx);
    expect(r.updates[0]!.tag).toEqual([TAG_DELIVERY]);
  });
  it('второй счёт VCB тоже подходит', () => {
    const r = reconcile([ev()], [], [op({ outcomeAccount: ACC_B, incomeAccount: ACC_B })], ctx);
    expect(r.outcomes[0]!.status).toBe('applied');
  });
});

describe('reconcile: чего не трогаем', () => {
  it('ручная операция — только подсказка', () => {
    const manual = op({ comment: 'пицца', payee: null, originalPayee: null });
    const r = reconcile([ev()], [], [manual], ctx);
    expect(r.outcomes[0]).toMatchObject({ status: 'manual', match: manual });
    expect(r.updates).toEqual([]);
  });
  it('повтор: метка чека уже стоит', () => {
    const done = op({ comment: '[vcb:00000000001] TEST KITCHEN [grab:A-0TESTFOOD0001AV]', tag: [TAG_DELIVERY] });
    const r = reconcile([ev()], [], [done], ctx);
    expect(r.outcomes[0]!.status).toBe('already');
    expect(r.updates).toEqual([]);
  });
  it.each([
    ['другая сумма', { outcome: 246000 }],
    ['другой день', { date: '2026-11-07' }],
    ['чужой счёт', { outcomeAccount: 'x', incomeAccount: 'x' }],
    ['перевод между своими', { incomeAccount: ACC_B, income: 245000 }],
    ['доход', { outcome: 0, income: 245000 }],
    ['удалена', { deleted: true }],
    ['комиссия', { comment: 'Комиссия за перевод [vcb:00000000001:fee]' }],
    ['получатель — магазин', { originalPayee: 'CONG TY TEST', payee: 'CONG TY TEST' }],
    ['уже подтверждена другим чеком', { comment: '[vcb:00000000001] X [grab:A-OTHER]' }],
  ])('не подходит: %s', (_n, over) => {
    const r = reconcile([ev()], [], [op(over as Partial<ZenTransaction>)], ctx);
    expect(r.outcomes[0]!.status).toBe('waiting');
    expect(r.updates).toEqual([]);
  });
  it('две операции скрипта с одной суммой — не угадываем', () => {
    const r = reconcile([ev()], [op({ id: 'new' , comment: '[vcb:2]' })], [op()], ctx);
    expect(r.outcomes[0]).toMatchObject({ status: 'ambiguous', count: 2 });
    expect(r.updates).toEqual([]);
    expect(r.creates[0]!.tag).toBeNull();
  });
  it('два чека на одну сумму и одна операция: второй ждёт', () => {
    const r = reconcile([ev(), ev({ orderId: 'A-SECOND', gmailMessageId: 'r2' })], [], [op()], ctx);
    expect(r.outcomes.map((o) => o.status)).toEqual(['applied', 'waiting']);
    expect(r.updates).toHaveLength(1);
  });
  it('нет операции: ждём 3 дня, потом — не найдено', () => {
    expect(reconcile([ev()], [], [], { ...ctx, today: '2026-11-10' }).outcomes[0]!.status).toBe('waiting');
    expect(reconcile([ev()], [], [], { ...ctx, today: '2026-11-11' }).outcomes[0]!.status).toBe('expired');
  });
  it('нет категории в Дзен-мани — ничего не делаем', () => {
    const r = reconcile([ev()], [], [op()], { ...ctx, tagsByTitle: {} });
    expect(r.outcomes[0]!.status).toBe('no-tag');
    expect(r.updates).toEqual([]);
  });
  it('обновление не содержит удаления', () => {
    const r = reconcile([ev()], [], [op()], ctx);
    expect(r.updates.every((t) => t.deleted === false)).toBe(true);
  });
});
