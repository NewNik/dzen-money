import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { categorize, looksLikePerson } from '../src/core/rules';
import { processBatch, type RawEmail } from '../src/core/run';
import { maskAccount, maskDigits, normalize } from '../src/core/text';
import { uuidv5, vcbTxnId } from '../src/core/uuid';
import { serialize, writeRequest } from '../src/core/zen/client';
import { resolveTag, type ZenContext } from '../src/core/zen/mapper';
import type { CategoryRules, ParsedBankTxn, ZenTransaction } from '../src/core/types';

const rules = JSON.parse(readFileSync(new URL('../config/category-rules.json', import.meta.url), 'utf8')) as CategoryRules;
const fixture = (name: string) => readFileSync(new URL(`../fixtures/vcb/${name}.html`, import.meta.url), 'utf8');
const AUTH = 'mx.google.com; dkim=pass; spf=pass; dmarc=pass';
const FROM = 'VCBDigibank@info.vietcombank.com.vn';

const txn = (over: Partial<ParsedBankTxn>): ParsedBankTxn => ({
  source: 'vcb-email', emailType: 'transfer_receipt', orderNumber: '1', occurredAtLocal: '2026-11-09T10:00:00+07:00',
  dateLocal: '2026-11-09', amount: 50000, currency: 'VND', feeAmount: 0, debitAccount: '0000000851',
  beneficiaryName: 'X', ...over,
});

const ctx = (recent: ZenTransaction[] = []): ZenContext => ({
  userId: 1, vndId: 7,
  tags: [
    { id: 'food', title: 'Питание', parent: null },
    { id: 'treats', title: 'Хотелки', parent: 'food' },
    { id: 'delivery', title: 'Доставка еды', parent: 'food' },
    { id: 'home', title: 'Жильё ', parent: null },
    { id: 'util', title: 'Коммуналка', parent: 'home' },
  ],
  accounts: [{ id: 'acc-a', title: 'VND | A VCB ', instrument: 7 }, { id: 'acc-b', title: 'VND | B VCB', instrument: 7 }],
  recent,
});
const accounts = { accounts: { '0000000851': 'acc-a' } };
const email = (name: string, id = name): RawEmail => ({ id, from: FROM, authResults: AUTH, html: fixture(name) });
const run = (emails: RawEmail[], c = ctx(), local = []) => processBatch({ emails, ctx: c, accounts, rules, local, now: 1000 });

describe('uuid', () => {
  it('UUIDv5 по RFC 4122', () => {
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(vcbTxnId('10000000001')).toBe(vcbTxnId('10000000001'));
    expect(vcbTxnId('10000000001')).not.toBe(vcbTxnId('10000000001', ':fee'));
  });
});

describe('текст', () => {
  it('нормализация и маскирование', () => {
    expect(normalize('  EVN Miền   Trung ')).toBe('evn mien trung');
    expect(normalize('Đỗ Thị')).toBe('do thi');
    expect(maskAccount('1234567890')).toBe('****7890');
    expect(maskDigits('счёт 1234567890 сумма 80000')).toBe('счёт ****7890 сумма 80000');
  });
});

describe('категории', () => {
  it('ключевые слова в имени получателя', () => {
    expect(categorize(txn({ beneficiaryName: 'EVN Miền Trung' }), rules).tag).toBe('Жильё / Коммуналка');
    expect(categorize(txn({ beneficiaryName: 'WINCOMMERCE JSC' }), rules)).toMatchObject({ tag: 'Питание / Хотелки', merchant: 'WinMart' });
    expect(categorize(txn({ beneficiaryName: 'VMS' }), rules).tag).toBe('Связь');
    expect(categorize(txn({ beneficiaryName: 'PAYOO_PIZZA 4PS' }), rules).tag).toBe('Питание / Рестораны');
  });
  it('сеть со смешанными покупками — без категории, на проверку', () => {
    expect(categorize(txn({ beneficiaryName: 'CTCP TM BACH HOA XANH' }), rules)).toMatchObject({ tag: null, needsReview: true, merchant: 'Bach Hoa Xanh' });
  });
  it('физлицо с суммой курьера — доставка, на проверку', () => {
    expect(categorize(txn({ beneficiaryName: 'NGUYEN VAN TEST', amount: 245000 }), rules)).toMatchObject({ tag: 'Питание / Доставка еды', step: 'person', needsReview: true });
    expect(categorize(txn({ beneficiaryName: 'NGUYEN VAN TEST', amount: 245500 }), rules).step).not.toBe('person');
    expect(categorize(txn({ beneficiaryName: 'HO KINH DOANH TEST', amount: 245000 }), rules).tag).toBeNull();
    expect(looksLikePerson('CONG TY TNHH TEST')).toBe(false);
  });
  it('личное правило сильнее общих', () => {
    const local = [{ beneficiary: 'Nguyen Van Test', tag: 'Транспорт' }, { beneficiary: 'TEST SPOUSE', transferTo: 'VND | B VCB' }];
    expect(categorize(txn({ beneficiaryName: 'NGUYEN VAN TEST_123456', amount: 245000 }), rules, local)).toMatchObject({ tag: 'Транспорт', step: 'local', needsReview: false });
    expect(categorize(txn({ beneficiaryName: 'TEST SPOUSE' }), rules, local).transferTo).toBe('VND | B VCB');
  });
  it('запрещённые категории не назначаются', () => {
    const local = [{ beneficiary: 'X', tag: 'Корректировка' }];
    expect(categorize(txn({}), rules, local).tag).not.toBe('Корректировка');
  });
  it('поиск категории по пути', () => {
    expect(resolveTag('Жильё / Коммуналка', ctx().tags)).toBe('util');
    expect(resolveTag('Нет такой', ctx().tags)).toBeUndefined();
  });
});

describe('обработка пачки', () => {
  it('расход: поля операции', () => {
    const [r] = run([email('transfer')]);
    expect(r?.status).toBe('create');
    expect(r?.transactions).toHaveLength(1);
    expect(r?.transactions[0]).toMatchObject({
      id: vcbTxnId('10000000001'), date: '2026-11-09', outcome: 80000, income: 0,
      outcomeAccount: 'acc-a', incomeAccount: 'acc-a', outcomeInstrument: 7, incomeInstrument: 7,
      tag: ['treats'], originalPayee: 'HO KINH DOANH MINI MART TEST', deleted: false, user: 1,
    });
    expect(r?.transactions[0]?.comment).toContain('[vcb:10000000001]');
    expect(r?.line).not.toContain('0000000851');
  });
  it('повторный запуск ничего не создаёт', () => {
    const first = run([email('transfer')])[0]?.transactions ?? [];
    expect(run([email('transfer')], ctx(first))[0]?.status).toBe('already');
    expect(run([email('transfer', 'a'), email('transfer', 'b')]).map((r) => r.status)).toEqual(['create', 'already']);
  });
  it('внесённая вручную операция не дублируется', () => {
    const manual = (outcome: number, date = '2026-11-09'): ZenTransaction => ({
      ...(run([email('transfer')])[0]?.transactions[0] as ZenTransaction), id: 'manual', comment: 'Напитки', outcome, date,
    });
    expect(run([email('transfer')], ctx([manual(80000, '2026-11-10')]))[0]?.status).toBe('duplicate');
    expect(run([email('transfer')], ctx([manual(80500)]))[0]?.status).toBe('duplicate_fuzzy');
    expect(run([email('transfer')], ctx([manual(90000)]))[0]?.status).toBe('create');
    expect(run([email('transfer')], ctx([{ ...manual(80000), deleted: true }]))[0]?.status).toBe('create');
  });
  it('перевод между своими счетами', () => {
    const local = [{ beneficiary: 'HO KINH DOANH MINI MART TEST', transferTo: 'VND | B VCB' }];
    const t = run([email('transfer')], ctx(), local as never)[0]?.transactions[0];
    expect(t).toMatchObject({ outcomeAccount: 'acc-a', incomeAccount: 'acc-b', outcome: 80000, income: 80000, tag: null });
  });
  it('комиссия — отдельная операция', () => {
    const html = fixture('transfer').replace(/0 VND<br>&nbsp;<br>0\s*VND<br>0 VND/, '3,300 VND<br>&nbsp;<br>3,000 VND<br>300 VND');
    const r = run([{ id: 'x', from: FROM, authResults: AUTH, html }])[0];
    expect(r?.transactions.map((t) => t.outcome)).toEqual([80000, 3300]);
    expect(r?.transactions[1]?.id).toBe(vcbTxnId('10000000001', ':fee'));
  });
  it('подделка и неизвестный счёт не обрабатываются', () => {
    expect(run([{ ...email('transfer'), authResults: 'dkim=fail; spf=pass; dmarc=fail' }])[0]?.status).toBe('error');
    expect(run([{ ...email('transfer'), from: 'someone@example.com' }])[0]?.status).toBe('error');
    expect(run([{ ...email('transfer'), html: '<p>привет</p>' }])[0]?.status).toBe('unparsed');
    expect(processBatch({ emails: [email('transfer')], ctx: ctx(), accounts: { accounts: {} }, rules, local: [], now: 1 })[0]?.status).toBe('error');
  });
});

describe('клиент Дзен-мани', () => {
  it('удаления не отправляются', () => {
    const t = run([email('transfer')])[0]?.transactions[0] as ZenTransaction;
    expect(() => writeRequest(1, [{ ...t, deleted: true }])).toThrow();
    expect(() => serialize({ ...writeRequest(1, [t]), deletion: [] } as never)).toThrow();
    expect(JSON.parse(serialize(writeRequest(1, [t]))).transaction).toHaveLength(1);
  });
});
