import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAuthResults, parseVcbDate, parseVcbEmail, parseVnd, VcbParseError } from '../src/core/banks/vcb';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/vcb/${name}.html`, import.meta.url), 'utf8');

describe('разбор писем VCB', () => {
  it('перевод по счёту', () => {
    expect(parseVcbEmail(fixture('transfer'))).toEqual({
      source: 'vcb-email', emailType: 'transfer_receipt', orderNumber: '10000000001',
      occurredAtLocal: '2026-11-09T21:57:00+07:00', dateLocal: '2026-11-09',
      amount: 80000, currency: 'VND', feeAmount: 0, debitAccount: '0000000851',
      creditAccount: '11111111111', remitterName: 'TEST USER',
      beneficiaryName: 'HO KINH DOANH MINI MART TEST', beneficiaryBank: 'TienPhong Commercial Joint Stock Bank',
      billCode: undefined, details: 'TEST USER transfer',
    });
  });

  it('перевод на счёт/карту: сумма из Debit Amount, счёт из Account number', () => {
    const t = parseVcbEmail(fixture('transfer-account-card'));
    expect(t).toMatchObject({
      emailType: 'transfer_account_card', orderNumber: '10000000002', dateLocal: '2026-11-09',
      amount: 186000, feeAmount: 0, creditAccount: '2222222222',
      beneficiaryName: 'NGUYEN VAN TEST', beneficiaryBank: 'Vietcombank',
    });
    expect(t.remitterName).toBeUndefined();
  });

  it('оплата счёта', () => {
    expect(parseVcbEmail(fixture('bill-payment'))).toMatchObject({
      emailType: 'bill_payment', orderNumber: '10000000003', dateLocal: '2026-11-07',
      amount: 3084912, billCode: 'PQ00000000001', beneficiaryName: 'EVN Miền Trung',
    });
  });

  it('перевод на карту', () => {
    const t = parseVcbEmail(fixture('card-transfer'));
    expect(t).toMatchObject({
      emailType: 'card_transfer', orderNumber: '10000000004', dateLocal: '2026-08-09',
      amount: 637000, feeAmount: 0, beneficiaryName: 'TRAN VAN TEST',
    });
    expect(t.beneficiaryBank).toBeUndefined();
  });

  it('комиссия берётся первой из трёх значений', () => {
    const html = fixture('transfer').replace(/0 VND<br>&nbsp;<br>0\s*VND<br>0 VND/, '3,300 VND<br>&nbsp;<br>3,000 VND<br>300 VND');
    expect(parseVcbEmail(html).feeAmount).toBe(3300);
  });

  it('отсутствие поля — ошибка, а не ноль', () => {
    const html = fixture('transfer').replace('80,000 VND', '');
    expect(() => parseVcbEmail(html)).toThrow(VcbParseError);
    expect(() => parseVcbEmail('<table><tr><td>hello</td></tr></table>')).toThrow(VcbParseError);
  });

  it('чужая валюта — ошибка', () => {
    expect(() => parseVcbEmail(fixture('transfer').replace('80,000 VND', '80.00 USD'))).toThrow(VcbParseError);
  });

  it('суммы и даты', () => {
    expect(parseVnd('1,234,567 VND', 'x')).toBe(1234567);
    expect(parseVnd('74,000 VND', 'x')).toBe(74000);
    expect(() => parseVnd('VND', 'x')).toThrow();
    expect(parseVcbDate('00:15 Sunday 08/11/2026')).toEqual({ dateLocal: '2026-11-08', occurredAtLocal: '2026-11-08T00:15:00+07:00' });
    expect(() => parseVcbDate('25:00 Sunday 08/13/2026')).toThrow();
  });

  it('проверка подлинности', () => {
    expect(parseAuthResults('mx.google.com; dkim=pass header.i=@x; spf=pass (ok); dmarc=pass (p=REJECT)')).toEqual({ dkim: true, spf: true, dmarc: true });
    expect(parseAuthResults('mx.google.com; dkim=fail; spf=pass; dmarc=fail')).toEqual({ dkim: false, spf: true, dmarc: false });
  });
});
