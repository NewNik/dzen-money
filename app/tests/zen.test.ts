import { describe, expect, it } from 'vitest';
import type { ParsedBankTxn, ZenTransaction } from '../src/core/types';
import { uuidv5, vcbTxnId } from '../src/core/uuid';
import { planWrites, type ExistingTxn } from '../src/core/zen/dedup';
import { missingAfterWrite, readMeta, writeRequest } from '../src/core/zen/diff';
import { toZenTransactions, type ZenContext } from '../src/core/zen/mapper';
import { formatDecision, planMessages } from '../src/core/zen/plan';
import { compileRules, findRule, foldText, type Rule } from '../src/core/zen/rules';
import defaultRules from '../config/rules.json';

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
  it('записанная заново (другой id, та же метка) считается уже записанной', () => {
    const e = existing({ id: uuidv5('vcb:00000000001:r1'), comment: '[vcb:00000000001]' });
    expect(planWrites([cand!], [existing({ id: cand!.id, deleted: true }), e])[0]!.action).toBe('exists');
    expect(planWrites([cand!], [existing({ id: cand!.id, deleted: true }), e], new Set([cand!.id]))[0]!.action).toBe('exists');
  });
  it('метка комиссии не путается с меткой основной операции', () => {
    expect(planWrites([cand!], [existing({ id: 'x', comment: '[vcb:00000000001:fee]', outcome: 1 })])[0]!.action).toBe('create');
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
  it('REDO: удалённая восстанавливается, ручной дубль не мешает, существующая не трогается', () => {
    const redo = new Set([cand!.id]);
    const r = planWrites([cand!], [existing({ id: cand!.id, deleted: true })], redo)[0]!;
    expect([r.action, r.txn.id]).toEqual(['restore', uuidv5('vcb:00000000001:r1')]);
    // вторая попытка после ещё одного удаления — следующий id
    const r2 = planWrites(
      [cand!],
      [existing({ id: cand!.id, deleted: true }), existing({ id: uuidv5('vcb:00000000001:r1'), deleted: true, comment: '[vcb:00000000001]' })],
      redo,
    )[0]!;
    expect(r2.txn.id).toBe(uuidv5('vcb:00000000001:r2'));
    expect(planWrites([cand!], [existing({})], redo)[0]!.action).toBe('create');
    expect(planWrites([cand!], [existing({ id: cand!.id, comment: '[vcb:1]' })], redo)[0]!.action).toBe('exists');
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
  it('REDO по Order Number: удалённая основная и комиссия восстанавливаются', () => {
    const t = parsed({ feeAmount: 3300 });
    const del = [existing({ id: vcbTxnId('00000000001'), deleted: true }), existing({ id: vcbTxnId('00000000001', true), deleted: true, outcome: 3300 })];
    expect(planMessages([{ msgId: 'a', txn: t }], ctx, ids, del)[0]!.status).toBe('done');
    const [p] = planMessages([{ msgId: 'a', txn: t }], ctx, ids, del, new Set(['00000000001']));
    expect([p!.status, p!.decisions.map((d) => d.action), p!.creates.length]).toEqual(['create', ['restore', 'restore'], 2]);
  });
  it('UUID из ACCOUNTS, которого нет в Дзен-мани, — unmapped', () => {
    const [p] = planMessages([{ msgId: 'a', txn: parsed() }], ctx, new Set([ACC_B]), []);
    expect(p!.status).toBe('unmapped');
  });
  it('лог маскирует длинные номера в комментарии', () => {
    const [p] = planMessages([{ msgId: 'a', txn: parsed({ details: 'MBVCB.1234567890851.x' }) }], ctx, ids, []);
    expect(formatDecision(p!.decisions[0]!)).toBe(
      `create id=${vcbTxnId('00000000001')} 2026-11-08 -74000 acc=aaaaaaaa tag=- comment="MBVCB.****0851.x [vcb:00000000001]"`,
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
    expect(missingAfterWrite({ transaction: [{ id: 'x', deleted: true }] }, ['x'])).toEqual(['x']);
  });
});

describe('правила категорий', () => {
  const tags = { коммуналка: 'tag-util', связь: 'tag-tel', 'досуг': 'tag-fun' };
  // Письмо от 07.11.2026 (оплата электричества), счёт и номер договора заменены.
  const evn = parsed({
    beneficiaryName: 'EVN Miền Trung',
    details: 'MBVCB00000000001_20261107_EVNCPC_PQ00000000000',
    amount: 3084912,
  });

  it('foldText: регистр, диакритика, đ', () => {
    expect(foldText('  EVN  Miền Trung Đà Nẵng ')).toBe('evn mien trung da nang');
  });
  it('встроенные правила компилируются и ловят EVN по получателю и по назначению', () => {
    const { rules, errors } = compileRules(defaultRules as Rule[], tags);
    expect(errors).toEqual([]);
    expect(findRule(evn, rules)?.tagId).toBe('tag-util');
    expect(findRule(parsed({ beneficiaryName: 'X', details: 'MBVCB1_2_EVNCPC_PQ1' }), rules)?.tagId).toBe('tag-util');
    expect(findRule(parsed({ beneficiaryName: 'STEVEN NGUYEN', details: 'never' }), rules)).toBeUndefined();
  });
  it('маппер ставит категорию и подменяет получателя, originalPayee — как в письме', () => {
    const { rules } = compileRules(defaultRules as Rule[], tags);
    const r = toZenTransactions(evn, { ...ctx, rules });
    expect(r.ok && [r.txns[0]!.tag, r.txns[0]!.payee, r.txns[0]!.originalPayee]).toEqual([
      ['tag-util'],
      'EVN (электричество)',
      'EVN Miền Trung',
    ]);
  });
  it('без совпадения категория null', () => {
    const { rules } = compileRules(defaultRules as Rule[], tags);
    const r = toZenTransactions(parsed(), { ...ctx, rules });
    expect(r.ok && r.txns[0]!.tag).toBeNull();
  });
  it('подстрока, поле, порядок: первое совпадение побеждает', () => {
    const { rules } = compileRules(
      [
        { match: 'nguyen van', field: 'payee', tag: 'Связь' },
        { match: 'shop', tag: 'Досуг ' },
      ],
      tags,
    );
    expect(findRule(parsed({ beneficiaryName: 'NGUYỄN VĂN A' }), rules)?.tagId).toBe('tag-tel');
    expect(findRule(parsed({ beneficiaryName: 'B', details: 'nguyen van' }), rules)).toBeUndefined(); // только payee
    expect(findRule(parsed({ beneficiaryName: 'TEST SHOP' }), rules)?.tagId).toBe('tag-fun');
  });
  it('перевод между своими не категоризируется', () => {
    const { rules } = compileRules([{ match: 'shop', tag: 'Связь' }], tags);
    expect(findRule(parsed({ kind: 'transfer' }), rules)).toBeUndefined();
  });
  it('ошибки в правилах — в список, остальные работают', () => {
    const r = compileRules(
      [{ match: 'a', tag: 'Нет такой' }, { match: '/(/', tag: 'Связь' }, { tag: 'Связь' } as Rule, { match: 'b', tag: 'Связь' }],
      tags,
    );
    expect(r.rules).toHaveLength(1);
    expect(r.errors).toEqual([
      'правило 1 (a): нет категории «Нет такой» в Дзен-мани',
      'правило 2 (/(/): неверная регулярка',
      'правило 3 (?): нужны поля match и tag',
    ]);
  });
  it('лог показывает название категории', () => {
    const { rules } = compileRules(defaultRules as Rule[], tags);
    const [p] = planMessages([{ msgId: 'a', txn: evn }], { ...ctx, rules }, ids, []);
    expect(formatDecision(p!.decisions[0]!, { 'tag-util': 'Коммуналка' })).toContain('tag=Коммуналка');
  });
});
