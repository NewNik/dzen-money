import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseTransferReceipt,
  parseTransferReceiptCells,
  parseVcbAmount,
  parseVcbDateTime,
} from '../src/core/banks/vcb/transfer-receipt';
import { htmlToCells, textToCells } from '../src/core/html';
import { uuidv5, vcbTxnId } from '../src/core/uuid';

const ctx = {
  gmailMessageId: 'test',
  auth: { dkim: true, spf: true, dmarc: true },
  ownAccounts: ['0000000000', '2222222222'],
};
const dir = join(__dirname, '../fixtures/vcb/transfer_receipt');

describe('фикстуры transfer_receipt', () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.html'))) {
    it(f, () => {
      const expected = JSON.parse(readFileSync(join(dir, f.replace('.html', '.expected.json')), 'utf8'));
      const r = parseTransferReceipt(readFileSync(join(dir, f), 'utf8'), ctx);
      expect(r).toEqual({ ok: true, txn: expected });
    });
  }

  it('текстовый образец из kb/samples', () => {
    const text = readFileSync(join(__dirname, '../../kb/samples/vcb-transfer-receipt.sample.txt'), 'utf8');
    const r = parseTransferReceiptCells(textToCells(text), ctx);
    expect(r.ok && r.txn).toMatchObject({
      orderNumber: '00000000001',
      dateLocal: '2026-11-08',
      amount: 74000,
      feeAmount: 0,
      beneficiaryName: 'TEST SHOP',
      details: 'TEST USER transfer',
      kind: 'expense',
    });
  });
});

describe('граничные случаи', () => {
  const html = readFileSync(join(dir, '01-two-column.html'), 'utf8');

  it('нет подписи суммы → ошибка, а не 0', () => {
    const r = parseTransferReceipt(html.replace(/<tr><td>Số tiền<br>.*?<\/tr>/, ''), ctx);
    expect(r).toEqual({ ok: false, error: 'нет полей: amount' });
  });
  it('пустое значение не берётся из следующей подписи', () => {
    const r = parseTransferReceipt(html.replace('<td>74,000 VND</td>', '<td></td>'), ctx);
    expect(r.ok).toBe(false);
  });
  it('«Số tiền» не путается с «Số tiền phí»', () => {
    const cells = htmlToCells(html.replace('<td>0 VND</td>', '<td>3,300 VND</td>'));
    const r = parseTransferReceiptCells(cells, ctx);
    expect(r.ok && [r.txn.amount, r.txn.feeAmount]).toEqual([74000, 3300]);
  });
  it('чужие счета → unknown', () => {
    const r = parseTransferReceipt(html, { ...ctx, ownAccounts: [] });
    expect(r.ok && r.txn.kind).toBe('unknown');
  });
  it('другая валюта сохраняется', () => {
    const r = parseTransferReceipt(html.replace('74,000 VND', '12.50 USD'), ctx);
    expect(r.ok && [r.txn.amount, r.txn.currency]).toEqual([12.5, 'USD']);
  });

  it('дата и время', () => {
    expect(parseVcbDateTime('00:15 Monday 09/11/2026')).toEqual({
      occurredAtLocal: '2026-11-09T00:15:00+07:00',
      dateLocal: '2026-11-09',
    });
    expect(parseVcbDateTime('23:59:07 Thứ Hai 01/02/2027')?.occurredAtLocal).toBe('2027-02-01T23:59:07+07:00');
    expect(parseVcbDateTime('10:57 Sunday 31/02/2026')).toBeNull();
    expect(parseVcbDateTime('08/11/2026')).toBeNull();
  });
  it('сумма', () => {
    expect(parseVcbAmount('1,234,567 VND')).toEqual({ amount: 1234567, currency: 'VND' });
    expect(parseVcbAmount('500 VND')).toEqual({ amount: 500, currency: 'VND' });
    expect(parseVcbAmount('74.000 VND')).toEqual({ amount: 74, currency: 'VND' });
    expect(parseVcbAmount('74,00 VND')).toBeNull();
    expect(parseVcbAmount('VND')).toBeNull();
    expect(parseVcbAmount('')).toBeNull();
  });
});

describe('uuid', () => {
  it('эталон RFC (python uuid5)', () => {
    expect(uuidv5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });
  it('совпадает с id тестовой операции этапа 0', () => {
    expect(uuidv5('vcb:test')).toBe('a0863506-dd17-5c17-b9b1-ed0097621c6e');
  });
  it('детерминирован, комиссия — отдельный id', () => {
    expect(vcbTxnId('16929155058')).toBe(vcbTxnId('16929155058'));
    expect(vcbTxnId('16929155058', true)).not.toBe(vcbTxnId('16929155058'));
  });
  it('длинное имя и не-ASCII', () => {
    const name = 'vcb:' + 'đ'.repeat(100);
    expect(uuidv5(name)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
