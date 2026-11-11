import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTrusted, parseAuthResults, topAuthResultsHeader } from '../src/core/auth';
import { anonymizeHtml } from '../src/core/banks/vcb/anonymize';
import { parseTransferReceipt } from '../src/core/banks/vcb/transfer-receipt';
import { formatLog, maskAccount, processEmail } from '../src/core/pipeline';

const ORG = 'vietcombank.com.vn';
const html = readFileSync(join(__dirname, '../fixtures/vcb/transfer_receipt/01-two-column.html'), 'utf8');
const FROM = 'VCB Digibank <VCBDigibank@info.vietcombank.com.vn>';

const AR_OK =
  'Authentication-Results: mx.google.com;\r\n' +
  '       dkim=pass header.i=@info.vietcombank.com.vn header.s=sel1 header.b=AbCd;\r\n' +
  '       spf=pass (google.com: domain of b@info.vietcombank.com.vn designates 192.0.2.1 as permitted sender) smtp.mailfrom=b@info.vietcombank.com.vn;\r\n' +
  '       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=vietcombank.com.vn\r\n';
// автопересылка: SPF относится к пересылающему серверу
const AR_FWD =
  'Authentication-Results: mx.google.com;\r\n' +
  '       dkim=pass header.i=@info.vietcombank.com.vn header.s=sel1 header.b=AbCd;\r\n' +
  '       spf=pass (google.com: domain of someone+caf_=x@gmail.com designates 209.85.220.41 as permitted sender) smtp.mailfrom="someone+caf_=x@gmail.com";\r\n' +
  '       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=info.vietcombank.com.vn\r\n';
const raw = (headers: string) => `Delivered-To: x@example.com\r\n${headers}Subject: t\r\n\r\nbody`;

describe('Authentication-Results', () => {
  it('прямое письмо', () => {
    const a = parseAuthResults(topAuthResultsHeader(raw(AR_OK)), ORG);
    expect(a).toEqual({ dkim: true, spf: true, dmarc: true });
  });
  it('пересланное: без SPF, но доверенное', () => {
    const a = parseAuthResults(topAuthResultsHeader(raw(AR_FWD)), ORG);
    expect(a).toEqual({ dkim: true, spf: false, dmarc: true });
    expect(isTrusted(a)).toBe(true);
  });
  it('берётся только верхний заголовок', () => {
    const fail = 'Authentication-Results: mx.google.com; dkim=fail header.i=@info.vietcombank.com.vn; dmarc=fail header.from=vietcombank.com.vn\r\n';
    expect(isTrusted(parseAuthResults(topAuthResultsHeader(raw(fail + AR_OK)), ORG))).toBe(false);
  });
  it('чужой authserv-id не считается', () => {
    const fake = AR_OK.replace('mx.google.com', 'mx.evil.example');
    expect(parseAuthResults(topAuthResultsHeader(raw(fake)), ORG)).toEqual({ dkim: false, spf: false, dmarc: false });
  });
  it('pass для чужого домена не считается', () => {
    const other = AR_OK.replace(/vietcombank\.com\.vn/g, 'evil-vietcombank.com.vn');
    expect(isTrusted(parseAuthResults(topAuthResultsHeader(raw(other)), ORG))).toBe(false);
  });
  it('заголовок в теле письма игнорируется, ARC-заголовок — тоже', () => {
    expect(topAuthResultsHeader(`Subject: t\r\n\r\n${AR_OK}`)).toBeNull();
    expect(topAuthResultsHeader(raw('ARC-' + AR_OK))).toBeNull();
  });
});

describe('processEmail', () => {
  const own = ['0000000000'];
  it('разобрано', () => {
    const o = processEmail({ id: 'm1', from: FROM, html, raw: raw(AR_OK) }, own);
    expect(o.status).toBe('parsed');
    const line = formatLog('m1', o);
    expect(line).toContain('74000 VND');
    expect(line).toContain('debit=****0000 credit=****1111');
    expect(line).not.toMatch(/(debit|credit)=\d|111111111111|TEST/);
  });
  it('чужой отправитель → карантин', () => {
    const o = processEmail({ id: 'm1', from: 'VCB <x@evil.example>', html, raw: raw(AR_OK) }, own);
    expect(o).toMatchObject({ status: 'quarantine', reason: 'чужой отправитель' });
  });
  it('нет DKIM → карантин', () => {
    expect(processEmail({ id: 'm1', from: FROM, html, raw: raw('') }, own).status).toBe('quarantine');
  });
  it('неизвестный формат → unparsed', () => {
    const o = processEmail({ id: 'm1', from: FROM, html: '<p>Thông báo</p>', raw: raw(AR_OK) }, own);
    expect(o.status).toBe('unparsed');
    expect(formatLog('m1', o)).toContain('нет полей');
  });
  it('maskAccount', () => {
    expect(maskAccount('1234560851')).toBe('****0851');
    expect(maskAccount(undefined)).toBe('-');
  });
});

describe('anonymizeHtml', () => {
  const src = html
    .replace('TEST SHOP', 'NGUYEN VAN A')
    .replace('00000000001', '16929155058')
    .replace('</table>', '<tr><td colspan="2">Hotline 1900 545413 <a href="https://x.example/u?id=42">a@b.vn</a></td></tr></table>');
  const out = anonymizeHtml(src);
  it('значения затёрты, подписи и структура на месте', () => {
    expect(out).not.toMatch(/NGUYEN|16929155058|74,000|545413|id=42|a@b\.vn/);
    expect(out).toContain('Số lệnh giao dịch');
    expect(out).toContain('<td>xxxxxx xxx x</td>');
    expect(out.match(/<tr>/g)?.length).toBe(src.match(/<tr>/g)?.length);
  });
  it('подписи после обезличивания по-прежнему находятся парсером', () => {
    const r = parseTransferReceipt(out, { gmailMessageId: 'x', auth: { dkim: true, spf: true, dmarc: true }, ownAccounts: [] });
    expect(r).toEqual({ ok: false, error: 'не разобрана дата' });
  });
});

describe('processReceiptEmail (чек Grab)', async () => {
  const { processReceiptEmail } = await import('../src/core/pipeline');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const html = readFileSync(join(__dirname, '../fixtures/grab/e_receipt/01-food.html'), 'utf8');
  const raw = (ar: string): string => `Authentication-Results: ${ar}\r\nSubject: x\r\n\r\nbody`;
  const ok = 'mx.google.com; dkim=pass header.i=@grab.com; spf=pass smtp.mailfrom=bounce@amazonses.com; dmarc=pass header.from=grab.com';
  const msg = { id: 'r1', from: 'Grab <no-reply@grab.com>', subject: 'Your Grab E-Receipt', html, raw: raw(ok) };

  it('подлинный чек разбирается', () => {
    const r = processReceiptEmail(msg);
    expect(r.status === 'receipt' && r.receipt.amount).toBe(312000);
  });
  it('чужой отправитель → карантин', () => {
    expect(processReceiptEmail({ ...msg, from: 'Grab <no-reply@grab.example>' }).status).toBe('quarantine');
  });
  it('DKIM другого домена → карантин', () => {
    const bad = ok.replace('header.i=@grab.com', 'header.i=@evil.example');
    expect(processReceiptEmail({ ...msg, raw: raw(bad) }).status).toBe('quarantine');
  });
  it('реклама с того же адреса → пропуск', () => {
    expect(processReceiptEmail({ ...msg, subject: 'NGÀN MÓN FLASH SALE' })).toEqual({ status: 'skip', reason: 'не чек' });
  });
  it('чек с неизвестной вёрсткой → не разобрано', () => {
    expect(processReceiptEmail({ ...msg, html: '<p>?</p>' }).status).toBe('unparsed');
  });
});
