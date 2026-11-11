import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeText } from '../src/core/html';
import {
  parseGrabAmount,
  parseGrabReceipt,
  parseGrabReceiptCells,
} from '../src/core/receipts/grab/e-receipt';

const ctx = { gmailMessageId: 'test' };
const dir = join(__dirname, '../fixtures/grab/e_receipt');
const food = readFileSync(join(dir, '01-food.html'), 'utf8');
const ride = readFileSync(join(dir, '02-ride.html'), 'utf8');

describe('фикстуры grab/e_receipt', () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.html'))) {
    it(f, () => {
      const expected = JSON.parse(readFileSync(join(dir, f.replace('.html', '.expected.json')), 'utf8'));
      expect(parseGrabReceipt(readFileSync(join(dir, f), 'utf8'), ctx)).toEqual({ ok: true, receipt: expected });
    });
  }

  it('текстовая версия из kb/samples (ячейки разделены «|»)', () => {
    const text = readFileSync(join(__dirname, '../../kb/samples/grab-food-receipt.sample.txt'), 'utf8');
    const cells = text.split(/\r?\n|\|/).map(normalizeText).filter((c) => c !== '');
    const r = parseGrabReceiptCells(cells, ctx);
    expect(r.ok && r.receipt).toMatchObject({
      kind: 'food',
      orderId: 'A-0TESTFOOD0002AV',
      occurredAtLocal: '2026-11-08T13:13:00+07:00',
      amount: 213000,
      paymentMethod: 'Cash',
      merchant: 'TEST KITCHEN - Test Mall',
    });
  });
});

describe('сумма', () => {
  it.each([
    ['245000', 245000],
    ['59.000', 59000],
    ['1,234,567', 1234567],
    ['4000', 4000],
  ])('%s → %d', (s, n) => expect(parseGrabAmount(s)).toBe(n));
  it.each(['59.00', '5,9000', '', '12.5', '-4000', '0'])('«%s» не сумма', (s) =>
    expect(parseGrabAmount(s)).toBeNull(),
  );
});

describe('граничные случаи', () => {
  it('подпись и значение в разных ячейках', () => {
    const r = parseGrabReceipt(food.replace(/<\/span> <span>/g, '</span><br><span>'), ctx);
    expect(r.ok && r.receipt.amount).toBe(312000);
    expect(r.ok && r.receipt.merchant).toBe('TEST MEAL - Food & Drink');
  });
  it('время 00:15 остаётся тем же днём', () => {
    const r = parseGrabReceipt(food.replace('08 Nov 26 18:53 +0700', '08 Nov 26 00:15 +0700'), ctx);
    expect(r.ok && r.receipt.occurredAtLocal).toBe('2026-11-08T00:15:00+07:00');
  });
  it('другое смещение приводится к UTC+7', () => {
    const r = parseGrabReceipt(food.replace('08 Nov 26 18:53 +0700', '08 Nov 26 23:30 +0000'), ctx);
    expect(r.ok && r.receipt).toMatchObject({ occurredAtLocal: '2026-11-09T06:30:00+07:00', dateLocal: '2026-11-09' });
  });
  it('итог и «BẠN TRẢ» расходятся → ошибка', () => {
    const r = parseGrabReceipt(food.replace('<td>BẠN TRẢ</td><td>312000₫</td>', '<td>BẠN TRẢ</td><td>300000₫</td>'), ctx);
    expect(r).toEqual({ ok: false, error: 'итог и «BẠN TRẢ» различаются' });
  });
  it('нет итога → ошибка, а не 0', () => {
    const r = parseGrabReceipt(food.replace('<span>312000₫</span>', ''), ctx);
    expect(r).toEqual({ ok: false, error: 'не разобрана сумма' });
  });
  it('нет номера заказа → ошибка', () => {
    const r = parseGrabReceipt(food.replace('A-0TESTFOOD0001AV', ''), ctx);
    expect(r.ok).toBe(false);
  });
  it('неверная дата → ошибка', () => {
    const r = parseGrabReceipt(food.replace('08 Nov 26', '31 Nov 26'), ctx);
    expect(r).toEqual({ ok: false, error: 'не разобрана дата' });
  });
  it('поездка без времени посадки: только дата', () => {
    const r = parseGrabReceipt(ride.replace('11:57AM', '').replace('12:15PM', ''), ctx);
    expect(r.ok && r.receipt.dateLocal).toBe('2026-10-19');
    expect(r.ok && r.receipt.occurredAtLocal).toBeUndefined();
  });
  it('поездка: 12:05AM → 00:05', () => {
    const r = parseGrabReceipt(ride.replace('11:57AM', '12:05AM'), ctx);
    expect(r.ok && r.receipt.occurredAtLocal).toBe('2026-10-19T00:05:00+07:00');
  });
  it('рекламное письмо Grab → ошибка', () => {
    const r = parseGrabReceipt('<table><tr><td>NGÀN MÓN FLASH SALE - GIẢM ĐẾN 50%</td></tr></table>', ctx);
    expect(r).toEqual({ ok: false, error: 'неизвестный вид чека Grab' });
  });
});
