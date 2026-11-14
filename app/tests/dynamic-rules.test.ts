import { describe, expect, it } from 'vitest';
import type { ParsedBankTxn, ZenTransaction } from '../src/core/types';
import {
  canonFromRules,
  compileDynamic,
  detailsKey,
  dynamicRules,
  formatDynamicRule,
  learn,
  observe,
  payeeKey,
  type Observation,
} from '../src/core/zen/dynamic-rules';
import { toZenTransactions, type ZenContext } from '../src/core/zen/mapper';
import { compileRules, findRule } from '../src/core/zen/rules';

const ACC = 'aaaaaaaa-0000-4000-8000-000000000001';
const ACC_2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const OWN = new Set([ACC, ACC_2]);
const NOW = 1_800_000_000;
const TITLES = { 'tag-food': 'Продукты', 'tag-fun': 'Хотелки', 'tag-rent': 'Аренда', 'tag-pay': 'Зарплата' };

let seq = 0;
/** Операция скрипта, которую человек открывал в приложении (changed заметно позже created). */
const op = (over: Partial<ZenTransaction> = {}): ZenTransaction => {
  seq += 1;
  return {
    id: `op-${seq}`,
    changed: NOW + seq + 3600,
    created: NOW + seq,
    user: 1,
    deleted: false,
    hold: null,
    incomeInstrument: 11902,
    incomeAccount: ACC,
    income: 0,
    outcomeInstrument: 11902,
    outcomeAccount: ACC,
    outcome: 50000,
    tag: ['tag-food'],
    merchant: null,
    payee: 'TEST SHOP',
    originalPayee: 'TEST SHOP',
    comment: `[vcb:${1000 + seq}]`,
    date: '2026-11-10',
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
    viewed: true,
    ...over,
  };
};

const parsed = (over: Partial<ParsedBankTxn> = {}): ParsedBankTxn => ({
  source: 'vcb-email',
  emailType: 'transfer_receipt',
  gmailMessageId: 'm1',
  orderNumber: '9001',
  occurredAtLocal: '2026-11-14T10:00:00+07:00',
  dateLocal: '2026-11-14',
  amount: 50000,
  currency: 'VND',
  feeAmount: 0,
  debitAccount: '1234567890',
  remitter: 'TEST USER',
  beneficiaryName: 'TEST SHOP',
  details: 'TEST USER transfer',
  kind: 'expense',
  auth: { dkim: true, spf: true, dmarc: true },
  ...over,
});

const tagFor = (history: ZenTransaction[], t: ParsedBankTxn): string | null | undefined =>
  findRule(t, dynamicRules(history, OWN, TITLES).rules)?.tagId;

describe('ключи признаков', () => {
  it('получатель — без регистра и диакритик', () => {
    expect(payeeKey('EVN Miền  Trung')).toBe('evn mien trung');
    expect(payeeKey('  ')).toBeUndefined();
    expect(payeeKey(undefined)).toBeUndefined();
  });
  it('назначение платежа — только осмысленные слова, не меньше двух', () => {
    expect(detailsKey('Tiền nhà tháng 11')).toBe('nha thang');
    expect(detailsKey('tien nha thang 12')).toBe('nha thang');
    expect(detailsKey('H2R16P')).toBeUndefined();
    expect(detailsKey('Thanh toan QR')).toBeUndefined();
    expect(detailsKey('MBVCB16917817252_20261107_EVNCPC_PQ10000952944')).toBeUndefined();
    expect(detailsKey('chuyen tien')).toBeUndefined();
    expect(detailsKey('')).toBeUndefined();
  });
});

describe('observe: какие операции считаются правкой человека', () => {
  const keys = (t: ZenTransaction) => observe([t], OWN).map((o) => `${o.direction}|${o.feature}|${o.key}|${o.tagId}`);
  it('операция скрипта с категорией, открытая в приложении', () => {
    expect(keys(op())).toEqual(['expense|payee|test shop|tag-food']);
  });
  it('назначение платежа даёт второй признак; метки в комментарии не мешают', () => {
    expect(keys(op({ comment: 'Tien nha thang 11 [vcb:77]', tag: ['tag-rent'] }))).toEqual([
      'expense|details|nha thang|tag-rent',
      'expense|payee|test shop|tag-rent',
    ]);
  });
  it('получатель берётся из originalPayee, а не из подменённого имени', () => {
    expect(keys(op({ payee: 'Bach Hoa Xanh', originalPayee: 'CTCP TM BACH HOA XANH' }))).toEqual([
      'expense|payee|ctcp tm bach hoa xanh|tag-food',
    ]);
  });
  it('доход запоминается отдельно от расхода', () => {
    expect(keys(op({ outcome: 0, income: 9_000_000, tag: ['tag-pay'] }))).toEqual(['income|payee|test shop|tag-pay']);
  });
  it('не учитываются: нетронутая, без категории, ручная, комиссия, перевод, чужой счёт, удалённая, с меткой чека', () => {
    const s = op();
    expect(keys({ ...s, changed: s.created + 2 })).toEqual([]); // автокатегория сервера, человек не видел
    expect(keys(op({ tag: null }))).toEqual([]);
    expect(keys(op({ tag: [] }))).toEqual([]);
    expect(keys(op({ comment: 'обед' }))).toEqual([]);
    expect(keys(op({ comment: 'Комиссия за перевод [vcb:5:fee]' }))).toEqual([]);
    expect(keys(op({ incomeAccount: ACC_2, income: 50000 }))).toEqual([]);
    expect(keys(op({ incomeAccount: 'x', outcomeAccount: 'x' }))).toEqual([]);
    expect(keys(op({ deleted: true }))).toEqual([]);
    expect(keys(op({ comment: '[vcb:6] TEST KITCHEN [grab:A-1]' }))).toEqual([]);
  });
});

describe('learn: политика «большинство из последних трёх»', () => {
  const o = (tagId: string, date: string, created = 0): Observation => ({ direction: 'expense', feature: 'payee', key: 'k', tagId, date, created });
  const tag = (...obs: Observation[]) => learn(obs)[0]!.tagId;
  it('одна правка — уже правило', () => {
    expect(learn([o('A', '2026-11-01')])).toEqual([
      { direction: 'expense', feature: 'payee', key: 'k', tagId: 'A', votes: 1, window: 1, lastDate: '2026-11-01' },
    ]);
  });
  it('при равенстве побеждает самая свежая', () => {
    expect(tag(o('A', '2026-11-01'), o('B', '2026-11-02'))).toBe('B');
    expect(tag(o('B', '2026-11-02'), o('A', '2026-11-01'))).toBe('B'); // порядок входа не важен
    expect(tag(o('A', '2026-11-02', 5), o('B', '2026-11-02', 9))).toBe('B'); // в один день — по времени записи
  });
  it('разовое исключение не сбивает привычную категорию, два подряд — меняют её', () => {
    expect(tag(o('A', '2026-11-01'), o('A', '2026-11-02'), o('B', '2026-11-03'))).toBe('A');
    expect(tag(o('A', '2026-11-01'), o('B', '2026-11-02'), o('B', '2026-11-03'))).toBe('B');
  });
  it('старые наблюдения за пределами окна не считаются', () => {
    const old = ['01', '02', '03', '04', '05'].map((d) => o('A', `2026-10-${d}`));
    expect(tag(...old, o('B', '2026-11-02'), o('B', '2026-11-03'))).toBe('B');
    expect(learn([...old, o('B', '2026-11-03')], { window: 1 })[0]!.tagId).toBe('B');
  });
  it('разные признаки и направления — разные правила', () => {
    const rules = learn([o('A', '2026-11-01'), { ...o('B', '2026-11-01'), key: 'k2' }, { ...o('C', '2026-11-01'), direction: 'income' }]);
    expect(rules.map((r) => `${r.direction}|${r.key}|${r.tagId}`).sort()).toEqual(['expense|k2|B', 'expense|k|A', 'income|k|C']);
  });
});

describe('динамические правила в поиске категории', () => {
  it('правка получателя без категории применяется к следующему письму', () => {
    const history = [op({ originalPayee: 'CTY TNHH TEST', tag: ['tag-fun'] })];
    expect(tagFor(history, parsed({ beneficiaryName: 'Cty TNHH  Test' }))).toBe('tag-fun');
    expect(tagFor(history, parsed({ beneficiaryName: 'CTY TNHH OTHER' }))).toBeUndefined();
  });
  it('расход не подходит под правило дохода и наоборот', () => {
    const history = [op({ originalPayee: 'NGUYEN VAN TEST', outcome: 0, income: 100000, tag: ['tag-pay'] })];
    expect(tagFor(history, parsed({ kind: 'income', remitter: 'NGUYEN VAN TEST', beneficiaryName: 'TEST USER' }))).toBe('tag-pay');
    expect(tagFor(history, parsed({ beneficiaryName: 'NGUYEN VAN TEST' }))).toBeUndefined();
  });
  it('назначение платежа сильнее получателя', () => {
    const history = [
      op({ originalPayee: 'NGUYEN VAN TEST', tag: ['tag-fun'] }),
      op({ originalPayee: 'NGUYEN VAN TEST', comment: 'tien nha thang 10 [vcb:1]', tag: ['tag-rent'], date: '2026-10-05' }),
    ];
    expect(tagFor(history, parsed({ beneficiaryName: 'TRAN THI TEST', details: 'Tiền nhà tháng 11' }))).toBe('tag-rent');
    expect(tagFor(history, parsed({ beneficiaryName: 'NGUYEN VAN TEST', details: 'Tiền nhà tháng 11' }))).toBe('tag-rent');
    expect(tagFor(history, parsed({ beneficiaryName: 'NGUYEN VAN TEST' }))).toBe('tag-fun');
  });
  it('автотекст «<имя> transfer» признаком не считается', () => {
    const history = [op({ originalPayee: 'A', comment: 'test user gui [vcb:1]', tag: ['tag-rent'] })];
    expect(tagFor(history, parsed({ beneficiaryName: 'B', details: 'TEST USER transfer' }))).toBeUndefined();
  });
  it('категория, удалённая из Дзен-мани, правила не даёт', () => {
    expect(compileDynamic(learn(observe([op({ tag: ['tag-gone'] })], OWN)), TITLES)).toEqual([]);
  });
  it('порядок: личные → динамические → встроенные; имя получателя остаётся от встроенного правила', () => {
    const tagsByTitle = { продукты: 'tag-food', хотелки: 'tag-fun', аренда: 'tag-rent' };
    const builtin = compileRules([{ match: 'bach hoa xanh', field: 'payee', tag: 'Продукты', payee: 'Bach Hoa Xanh' }], tagsByTitle).rules;
    const personal = compileRules([{ match: 'landlord', tag: 'Аренда' }], tagsByTitle).rules;
    const history = [
      op({ payee: 'Bach Hoa Xanh', originalPayee: 'CTCP TM BACH HOA XANH', tag: ['tag-fun'] }),
      op({ originalPayee: 'LANDLORD TEST', tag: ['tag-fun'] }),
    ];
    const rules = [...personal, ...dynamicRules(history, OWN, TITLES, canonFromRules([...personal, ...builtin])).rules, ...builtin];
    const ctx: ZenContext = { accounts: { '1234567890': ACC }, userId: 1, instruments: { VND: 11902 }, now: NOW, rules };
    const bhx = toZenTransactions(parsed({ beneficiaryName: 'CTCP TM BACH HOA XANH' }), ctx);
    expect(bhx.ok && bhx.txns[0]).toMatchObject({ tag: ['tag-fun'], payee: 'Bach Hoa Xanh', originalPayee: 'CTCP TM BACH HOA XANH' });
    // другое написание той же сети — то же единое имя, то же динамическое правило
    const other = toZenTransactions(parsed({ beneficiaryName: 'CTY CP BACH HOA XANH' }), ctx);
    expect(other.ok && other.txns[0]).toMatchObject({ tag: ['tag-fun'], payee: 'Bach Hoa Xanh' });
    const rent = toZenTransactions(parsed({ beneficiaryName: 'LANDLORD TEST' }), ctx);
    expect(rent.ok && rent.txns[0]).toMatchObject({ tag: ['tag-rent'] });
  });
});

describe('единое имя получателя', () => {
  const builtin = compileRules(
    [
      { match: '/bach hoa xanh|bhx/', field: 'payee', tag: 'Продукты', payee: 'Bach Hoa Xanh' },
      { match: 'grab', field: 'payee', tag: 'Продукты', payee: 'Grab', amountMax: 100000 },
      { match: 'thue nha', field: 'details', tag: 'Аренда', payee: 'Хозяин' },
    ],
    { продукты: 'tag-food', аренда: 'tag-rent' },
  ).rules;
  const canon = canonFromRules(builtin);
  it('берётся из обычных правил с подменой получателя, сумма не важна', () => {
    expect(canon('CTCP TM BACH HOA XANH')).toBe('Bach Hoa Xanh');
    expect(canon('GRAB VIETNAM')).toBe('Grab');
    expect(canon('thue nha')).toBe('thue nha'); // правило по назначению платежа имя не задаёт
    expect(canon('TEST SHOP')).toBe('TEST SHOP');
  });
  it('правки по разным написаниям складываются в одно правило', () => {
    const history = [
      op({ originalPayee: 'CTY CO PHAN THUONG MAI BACH HOA XANH', date: '2026-11-11' }),
      op({ originalPayee: 'CTCP TM BACH HOA XANH', date: '2026-11-12' }),
      op({ payee: 'Bach Hoa Xanh', originalPayee: 'CTY CP TM BACH HOA XANH', tag: ['tag-fun'], date: '2026-11-13' }),
    ];
    expect(learn(observe(history, OWN, canon))).toEqual([
      { direction: 'expense', feature: 'payee', key: 'bach hoa xanh', tagId: 'tag-food', votes: 2, window: 3, lastDate: '2026-11-13' },
    ]);
  });
});

describe('formatDynamicRule', () => {
  it('имя человека сокращается, название магазина — нет', () => {
    const [person] = learn(observe([op({ originalPayee: 'NGUYEN VAN TEST' })], OWN));
    const [shop] = learn(observe([op({ originalPayee: 'HO KINH DOANH TEST MART' })], OWN));
    expect(formatDynamicRule(person!, TITLES)).toBe('получатель «n. v. t.» → Продукты (1 из 1, последняя 2026-11-10)');
    expect(formatDynamicRule(shop!, TITLES)).toContain('«ho kinh doanh test mart» → Продукты');
    const [chain] = learn(observe([op({ originalPayee: 'Bach Hoa Xanh' })], OWN));
    expect(formatDynamicRule(chain!, TITLES)).toContain('«b. h. x.»');
    expect(formatDynamicRule(chain!, TITLES, new Set(['bach hoa xanh']))).toContain('«bach hoa xanh»');
  });
});
