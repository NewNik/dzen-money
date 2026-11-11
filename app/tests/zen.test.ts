import { describe, expect, it } from 'vitest';
import type { ParsedBankTxn, ZenTransaction } from '../src/core/types';
import { uuidv5, vcbTxnId } from '../src/core/uuid';
import { inexactMatch, planWrites, type ExistingTxn } from '../src/core/zen/dedup';
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
      existing({ outcome: 80000 }),
      existing({ outcomeAccount: ACC_B, incomeAccount: ACC_B }),
      existing({ deleted: true }),
      existing({ comment: 'x [vcb:00000000099]' }),
    ]) {
      expect(planWrites([cand!], [e])[0]!.action).toBe('create');
    }
  });
  describe('сумма, записанная по памяти', () => {
    const kind = (bank: number, manual: number) => inexactMatch(bank, manual);
    it('округление вверх некруглой суммы', () => {
      expect(kind(119600, 120000)).toBe('round-up');
      expect(kind(369908, 370000)).toBe('round-up');
      expect(kind(29400, 30000)).toBe('round-up');
      expect(kind(152324, 152400)).toBe('round-up');
      expect(kind(152324, 152500)).toBe('round-up');
      expect(kind(3084912, 3085000)).toBe('round-up');
      expect(kind(3084912, 3090000)).toBeUndefined(); // 84,9 → 90 дальше половины десятки
    });
    it('«первые цифры такие»: хвост заменён нулями', () => {
      expect(kind(111421, 111000)).toBe('first-digits');
      expect(kind(170025, 170000)).toBe('first-digits');
      expect(kind(3084912, 3080000)).toBe('first-digits');
    });
    it('опечатка: одна цифра или две соседние переставлены, первые три цифры те же', () => {
      expect(kind(202329, 202239)).toBe('typo');
      expect(kind(285420, 285470)).toBe('typo');
      expect(kind(285420, 295420)).toBeUndefined();
      expect(kind(285420, 285741)).toBeUndefined();
    });
    it('округление вверх: должен быть разряд, который округляется', () => {
      expect(kind(267000, 270000)).toBe('round-up'); // 67 → 70
      expect(kind(269000, 270000)).toBe('round-up');
      expect(kind(265000, 270000)).toBeUndefined(); // 5000 — больше порога 3000
      expect(kind(268000, 270000)).toBe('round-up');
      expect(kind(114000, 115000)).toBe('round-up'); // до пятёрки
      expect(kind(267400, 270000)).toBe('round-up');
      expect(kind(266999, 270000)).toBeUndefined(); // 3001
      expect(kind(1460000, 1500000)).toBeUndefined();
      expect(kind(1498000, 1500000)).toBe('round-up');
      expect(kind(203000, 206000)).toBeUndefined(); // 206 не ровнее, чем 203
      expect(kind(262000, 270000)).toBeUndefined(); // далеко: скажут 260 или 265
      expect(kind(203000, 210000)).toBeUndefined();
      expect(kind(262000, 265000)).toBeUndefined(); // дальше половины пятёрки
      expect(kind(269000, 268000)).toBeUndefined(); // вниз
      expect(kind(128000, 128800)).toBeUndefined();
    });
    it('мелкие суммы помнят точно: остаётся меньше двух значащих цифр', () => {
      expect(kind(67000, 70000)).toBeUndefined();
      expect(kind(33000, 35000)).toBeUndefined();
      expect(kind(74000, 75000)).toBeUndefined(); // для пятёрок порог строже
      expect(kind(19000, 20000)).toBeUndefined();
      expect(kind(95000, 100000)).toBeUndefined();
      expect(kind(98000, 100000)).toBe('round-up');
      expect(kind(74000, 74500)).toBeUndefined();
    });
    it('грубое округление и просто близкие суммы — не совпадение', () => {
      expect(kind(285420, 290000)).toBeUndefined(); // 4580 — больше порога 3000
      expect(kind(287420, 290000)).toBe('round-up');
      expect(kind(285420, 287000)).toBeUndefined(); // через одну тысячу
      expect(kind(285420, 284000)).toBeUndefined();
      expect(kind(119600, 119000)).toBe('first-digits');
      expect(kind(119600, 121000)).toBeUndefined();
      expect(kind(329374, 339000)).toBeUndefined();
      expect(kind(85300, 85300)).toBeUndefined();
    });
    it('в плане: причина названа, круглая сумма создаётся заново', () => {
      const [odd] = ok(parsed({ amount: 119600 }));
      expect(planWrites([odd!], [existing({ outcome: 120000 })])[0]).toMatchObject({ action: 'manual-duplicate', fuzzy: true, why: 'round-up' });
      expect(planWrites([odd!], [existing({ outcome: 121000 })])[0]!.action).toBe('create');
      expect(planWrites([cand!], [existing({ outcome: 74500 })])[0]!.action).toBe('create');
      const [big] = ok(parsed({ amount: 267000 }));
      expect(planWrites([big!], [existing({ outcome: 270000 })])[0]).toMatchObject({ action: 'manual-duplicate', why: 'round-up' });
      expect(planWrites([big!], [existing({ outcome: 269000 })])[0]!.action).toBe('create');
      expect(planWrites([cand!], [existing({})])[0]).toMatchObject({ action: 'manual-duplicate', fuzzy: false });
    });
    it('из нескольких похожих выбирается округление вверх', () => {
      const [odd] = ok(parsed({ amount: 119600 }));
      const d = planWrites([odd!], [existing({ id: 'down', outcome: 119000 }), existing({ id: 'up', outcome: 120000 })])[0]!;
      expect(d).toMatchObject({ why: 'round-up', match: { id: 'up' } });
    });
  });
  it('точное совпадение занимает ручную операцию раньше неточного', () => {
    const [near] = ok(parsed({ orderNumber: '00000000002', amount: 73600 }));
    const ds = planWrites([near!, cand!], [existing({})]);
    expect(ds.map((d) => d.action)).toEqual(['create', 'manual-duplicate']);
  });
  it('расход, записанный вручную на другой свой счёт, — дубль', () => {
    const other = existing({ outcomeAccount: ACC_B, incomeAccount: ACC_B });
    expect(planWrites([cand!], [other], new Set(), new Set([ACC_A, ACC_B]))[0]!.action).toBe('manual-duplicate');
    expect(planWrites([cand!], [other], new Set(), new Set([ACC_A]))[0]!.action).toBe('create');
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
    const all = Object.fromEntries(
      (defaultRules as Rule[]).filter((r) => r.tag !== null).map((r) => [r.tag!.toLowerCase(), 'tag-' + r.tag]),
    );
    const { rules, errors } = compileRules(defaultRules as Rule[], { ...all, ...tags });
    expect(errors).toEqual([]);
    expect(findRule(evn, rules)?.tagId).toBe('tag-util');
    expect(findRule(parsed({ beneficiaryName: 'X', details: 'MBVCB1_2_EVNCPC_PQ1' }), rules)?.tagId).toBe('tag-util');
    expect(findRule(parsed({ beneficiaryName: 'STEVEN NGUYEN', details: 'never' }), rules)).toBeUndefined();
  });
  describe('встроенные правила по письмам', () => {
    const all = Object.fromEntries(
      (defaultRules as Rule[]).filter((r) => r.tag !== null).map((r) => [r.tag!.toLowerCase(), r.tag!]),
    );
    const { rules } = compileRules(defaultRules as Rule[], all);
    const tagOf = (over: Partial<ParsedBankTxn>) => findRule(parsed({ details: 'TEST USER transfer', ...over }), rules)?.tagId;
    it('сети и службы по имени получателя', () => {
      expect(tagOf({ beneficiaryName: 'WINCOMMERCE JSC' })).toBe('Хотелки');
      expect(tagOf({ beneficiaryName: 'HO KINH DOANH MINI MART TEST' })).toBe('Хотелки');
      expect(tagOf({ beneficiaryName: 'VMS' })).toBe('Связь');
      expect(tagOf({ beneficiaryName: 'PAYOO_PIZZA 4PS' })).toBe('Рестораны');
      expect(tagOf({ beneficiaryName: 'NHA THUOC TEST_NGUYEN THI TEST' })).toBe('Здоровье');
      expect(tagOf({ beneficiaryName: 'HO KINH DOANH TEST PET SHOP' })).toBe('Кошки');
    });
    it('магазин со смешанными покупками и платёжный шлюз — правило без категории', () => {
      expect(findRule(parsed({ beneficiaryName: 'CTCP TM BACH HOA XANH' }), rules)).toMatchObject({ tagId: null });
      expect(findRule(parsed({ beneficiaryName: 'BAOKIM CONG THANH TOAN', amount: 245000 }), rules)).toMatchObject({ tagId: null });
      const r = toZenTransactions(parsed({ beneficiaryName: 'CTCP TM BACH HOA XANH' }), { ...ctx, rules });
      expect(r.ok && r.txns[0]).toMatchObject({ tag: null, payee: 'Bach Hoa Xanh', originalPayee: 'CTCP TM BACH HOA XANH' });
    });
    it('физлицо, 140–450 тыс., сумма кратна 1000 — доставка еды', () => {
      expect(tagOf({ beneficiaryName: 'NGUYEN VAN TEST', amount: 245000 })).toBe('Доставка еды');
      expect(tagOf({ beneficiaryName: 'NGUYEN VAN TEST', amount: 245500 })).toBeUndefined();
      expect(tagOf({ beneficiaryName: 'NGUYEN VAN TEST', amount: 74000 })).toBeUndefined();
      expect(tagOf({ beneficiaryName: 'NGUYEN VAN TEST', amount: 450000 })).toBeUndefined();
      expect(tagOf({ beneficiaryName: 'HO KINH DOANH TEST', amount: 245000 })).toBeUndefined();
      expect(tagOf({ kind: 'income', remitter: 'NGUYEN VAN TEST', beneficiaryName: 'TEST USER', amount: 245000 })).toBeUndefined();
    });
    it('имена людей не срабатывают как магазины', () => {
      for (const n of ['NGUYEN THU Y', 'LE VI', 'TRAN AN KHANG', 'STEVEN NGUYEN', 'PHAM KIM LONG']) {
        expect(tagOf({ beneficiaryName: n, amount: 30000 })).toBeUndefined();
      }
    });
  });

  it('личное правило проверяется раньше встроенного', () => {
    const { rules } = compileRules(
      [{ match: 'nguyen van test', field: 'payee', tag: 'Связь' }, { match: '/./', field: 'payee', tag: 'Досуг', person: true }],
      tags,
    );
    expect(findRule(parsed({ beneficiaryName: 'NGUYEN VAN TEST' }), rules)?.tagId).toBe('tag-tel');
    expect(findRule(parsed({ beneficiaryName: 'TRAN VAN TEST' }), rules)?.tagId).toBe('tag-fun');
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
