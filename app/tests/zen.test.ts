import { describe, expect, it } from 'vitest';
import type { ParsedBankTxn, ZenTransaction } from '../src/core/types';
import { vcbTxnId } from '../src/core/uuid';
import { planWrites, type ExistingTxn } from '../src/core/zen/dedup';
import { missingAfterWrite, readMeta, writeRequest } from '../src/core/zen/diff';
import { toZenTransactions, type ZenContext } from '../src/core/zen/mapper';
import { formatDecision, planMessages } from '../src/core/zen/plan';

const ACC_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ACC_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const ctx: ZenContext = {
  accounts: { '0000000000': ACC_A, '2222222222': ACC_B },
  userId: 100,
  instruments: { VND: 11902, USD: 1 },
  now: 1_800_000_000,
};
const ids = new Set([ACC_A, ACC_B]);

const parsed = (over: Partial<ParsedBankTxn> = {}): ParsedBankTxn => ({
  source: 'vcb-email',
  emailType: 'transfer_receipt',
  gmailMessageId: 'm1',
  orderNumber: '00000000001',
  occurredAtLocal: '2026-11-08T10:57:00+07:00',
  dateLocal: '2026-11-08',
  amount: 74000,
  currency: 'VND',
  feeAmount: 0,
  debitAccount: '0000000000',
  creditAccount: '111111111111',
  beneficiaryName: 'TEST SHOP',
  remitter: 'TEST USER',
  details: 'TEST USER transfer',
  kind: 'expense',
  auth: { dkim: true, spf: true, dmarc: true },
  ...over,
});

const ok = (t: ParsedBankTxn): ZenTransaction[] => {
  const r = toZenTransactions(t, ctx);
  if (!r.ok) throw new Error(r.reason);
  return r.txns;
};

const existing = (over: Partial<ExistingTxn>): ExistingTxn => ({
  id: 'manual-1',
  deleted: false,
  date: '2026-11-08',
  income: 0,
  outcome: 74000,
  incomeAccount: ACC_A,
  outcomeAccount: ACC_A,
  comment: null,
  ...over,
});

describe('маппер', () => {
  it('расход: один счёт, outcome = сумма, маркер в комментарии, все nullable-поля на месте', () => {
    const [t, ...rest] = ok(parsed());
    expect(rest).toEqual([]);
    expect(t).toEqual({
      id: vcbTxnId('00000000001'),
      changed: ctx.now,
      created: ctx.now,
      user: 100,
      deleted: false,
      hold: null,
      incomeInstrument: 11902,
      incomeAccount: ACC_A,
      income: 0,
      outcomeInstrument: 11902,
      outcomeAccount: ACC_A,
      outcome: 74000,
      tag: null,
      merchant: null,
      payee: 'TEST SHOP',
      originalPayee: 'TEST SHOP',
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
    });
  });
  it('доход: счёт зачисления, income = сумма, получатель — отправитель', () => {
    const [t] = ok(parsed({ kind: 'income', debitAccount: '999', creditAccount: '2222222222' }));
    expect([t!.incomeAccount, t!.outcomeAccount, t!.income, t!.outcome, t!.payee]).toEqual([ACC_B, ACC_B, 74000, 0, 'TEST USER']);
  });
  it('перевод между своими: два счёта, без получателя', () => {
    const [t] = ok(parsed({ kind: 'transfer', creditAccount: '2222222222' }));
    expect([t!.outcomeAccount, t!.incomeAccount, t!.outcome, t!.income, t!.payee]).toEqual([ACC_A, ACC_B, 74000, 74000, null]);
  });
  it('комиссия > 0 — отдельный расход со своим id', () => {
    const txns = ok(parsed({ feeAmount: 3300 }));
    expect(txns).toHaveLength(2);
    expect(txns[1]).toMatchObject({
      id: vcbTxnId('00000000001', true),
      outcomeAccount: ACC_A,
      outcome: 3300,
      comment: 'Комиссия за перевод [vcb:00000000001:fee]',
    });
  });
  it('без назначения платежа — только маркер', () => {
    expect(ok(parsed({ details: undefined }))[0]!.comment).toBe('[vcb:00000000001]');
  });
  it('автотекст VCB «<отправитель> transfer» отбрасывается, своё назначение остаётся', () => {
    expect(ok(parsed({ details: '  test  user TRANSFER ' }))[0]!.comment).toBe('[vcb:00000000001]');
    expect(ok(parsed({ details: 'TEST USER transfer rent' }))[0]!.comment).toBe('TEST USER transfer rent [vcb:00000000001]');
    expect(ok(parsed({ details: 'Tien nha thang 11' }))[0]!.comment).toBe('Tien nha thang 11 [vcb:00000000001]');
    expect(ok(parsed({ remitter: undefined }))[0]!.comment).toBe('TEST USER transfer [vcb:00000000001]');
  });
  it('unknown и неизвестная валюта — ошибка, а не операция', () => {
    expect(toZenTransactions(parsed({ kind: 'unknown' }), ctx).ok).toBe(false);
    expect(toZenTransactions(parsed({ currency: 'EUR' }), ctx)).toEqual({ ok: false, reason: 'нет валюты EUR в Дзен-мани' });
  });
});

describe('проверка дублей', () => {
  const [cand] = ok(parsed());
  it('нет похожих — создать', () => {
    expect(planWrites([cand!], [])[0]!.action).toBe('create');
  });
  it('тот же id уже есть — не отправлять', () => {
    expect(planWrites([cand!], [existing({ id: cand!.id, comment: '[vcb:00000000001]' })])[0]!.action).toBe('exists');
  });
  it('тот же id удалён в приложении — не воскрешать', () => {
    expect(planWrites([cand!], [existing({ id: cand!.id, deleted: true })])[0]!.action).toBe('deleted');
  });
  it('ручной ввод: тот же счёт и сумма, дата ±1 день → дубль', () => {
    expect(planWrites([cand!], [existing({ date: '2026-11-09' })])[0]!.action).toBe('manual-duplicate');
    expect(planWrites([cand!], [existing({ date: '2026-11-07' })])[0]!.action).toBe('manual-duplicate');
  });
  it('другая дата, сумма, счёт, удалённая или с маркером — не дубль', () => {
    for (const e of [
      existing({ date: '2026-11-10' }),
      existing({ outcome: 74001 }),
      existing({ outcomeAccount: ACC_B, incomeAccount: ACC_B }),
      existing({ deleted: true }),
      existing({ comment: 'x [vcb:00000000099]' }),
    ]) {
      expect(planWrites([cand!], [e])[0]!.action).toBe('create');
    }
  });
  it('одна ручная операция закрывает только одно письмо', () => {
    const [second] = ok(parsed({ orderNumber: '00000000002' }));
    expect(planWrites([cand!, second!], [existing({})]).map((d) => d.action)).toEqual(['manual-duplicate', 'create']);
  });
  it('ручной перевод на наличные тоже ловится по стороне списания', () => {
    expect(planWrites([cand!], [existing({ incomeAccount: 'cash', income: 74000 })])[0]!.action).toBe('manual-duplicate');
  });
});

describe('план по письмам', () => {
  it('итоги: create, done, duplicate, unmapped', () => {
    const a = parsed({ orderNumber: '1' });
    const b = parsed({ orderNumber: '2', amount: 5000 });
    const c = parsed({ orderNumber: '3', amount: 6000 });
    const d = parsed({ orderNumber: '4', kind: 'unknown' });
    const plans = planMessages(
      [
        { msgId: 'a', txn: a },
        { msgId: 'b', txn: b },
        { msgId: 'c', txn: c },
        { msgId: 'd', txn: d },
      ],
      ctx,
      ids,
      [existing({ id: vcbTxnId('2'), outcome: 5000, comment: '[vcb:2]' }), existing({ id: 'm', outcome: 6000 })],
    );
    expect(plans.map((p) => [p.msgId, p.status, p.creates.length])).toEqual([
      ['a', 'create', 1],
      ['b', 'done', 0],
      ['c', 'duplicate', 0],
      ['d', 'unmapped', 0],
    ]);
    expect(plans[2]!.reason).toBe('похожая ручная операция 2026-11-08 на 6000 (id m)');
  });
  it('дубль по основной операции — комиссию тоже не создаём', () => {
    const [p] = planMessages([{ msgId: 'a', txn: parsed({ feeAmount: 3300 }) }], ctx, ids, [existing({})]);
    expect([p!.status, p!.creates]).toEqual(['duplicate', []]);
  });
  it('UUID из ACCOUNTS, которого нет в Дзен-мани, — unmapped', () => {
    const [p] = planMessages([{ msgId: 'a', txn: parsed() }], ctx, new Set([ACC_B]), []);
    expect(p!.status).toBe('unmapped');
  });
  it('лог маскирует длинные номера в комментарии', () => {
    const [p] = planMessages([{ msgId: 'a', txn: parsed({ details: 'MBVCB.1234567890851.x' }) }], ctx, ids, []);
    expect(formatDecision(p!.decisions[0]!)).toBe(
      `create id=${vcbTxnId('00000000001')} 2026-11-08 -74000 acc=aaaaaaaa comment="MBVCB.****0851.x [vcb:00000000001]"`,
    );
  });
});

describe('diff', () => {
  it('метаданные: родительский пользователь, VND, неархивные счета', () => {
    const m = readMeta({
      serverTimestamp: 5,
      user: [
        { id: 1, parent: null },
        { id: 2, parent: 1 },
      ],
      instrument: [{ id: 11902, shortTitle: 'VND' }],
      account: [{ id: ACC_A }, { id: ACC_B, archive: true }],
    });
    expect([m.userId, m.instruments.VND, [...m.accountIds], m.serverTimestamp]).toEqual([1, 11902, [ACC_A], 5]);
  });
  it('запрос на запись без deletion', () => {
    const r = writeRequest(5, ok(parsed()), 6);
    expect(Object.keys(r).sort()).toEqual(['currentClientTimestamp', 'serverTimestamp', 'transaction']);
  });
  it('проверка ответа на запись', () => {
    expect(missingAfterWrite({ transaction: [{ id: 'x' }] }, ['x', 'y'])).toEqual(['y']);
  });
});
