// Парсер чека Grab («Your Grab E-Receipt»): доставка еды и поездка.
// Формат описан в kb/grab-emails/e-receipt.md.
// Подписи ищутся в склеенном тексте ячеек: стоит ли значение в одной ячейке с подписью, неизвестно.
import { htmlToCells } from '../../html';

export interface GrabReceipt {
  source: 'grab-email';
  kind: 'food' | 'ride';
  /** `GrabFood`, `GrabBike`, `GrabCar`… */
  service: string;
  gmailMessageId: string;
  /** Номер заказа или поездки `A-…` — ключ идемпотентности. */
  orderId: string;
  /** Еда — время заказа; поездка — время посадки, если нашлось. */
  occurredAtLocal?: string;
  dateLocal: string;
  amount: number;
  currency: 'VND';
  /** `Cash` — оплата мимо Grab (перевод курьеру или наличные). */
  paymentMethod?: string;
  /** Ресторан (только доставка еды). */
  merchant?: string;
}

export interface GrabParseContext {
  gmailMessageId: string;
}

export type GrabParseResult = { ok: true; receipt: GrabReceipt } | { ok: false; error: string };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthIndex = (name: string): number => MONTHS.indexOf(name.slice(0, 3).toLowerCase());
const p2 = (n: number): string => String(n).padStart(2, '0');

const validDate = (y: number, mo: number, d: number): boolean =>
  mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** `245000`, `59.000`, `1,234,567` → целые донги. Дробей у VND нет: точка и запятая — разделители тысяч. */
export function parseGrabAmount(s: string): number | null {
  const t = s.trim();
  if (!/^(?:\d{1,3}(?:[.,]\d{3})+|\d+)$/.test(t)) return null;
  const n = Number(t.replace(/[.,]/g, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** `10 Nov 26 13:13 +0700` → вьетнамское время (UTC+7). */
function foodDateTime(text: string): { occurredAtLocal: string; dateLocal: string } | null {
  const m = /\b(\d{1,2}) ([A-Za-z]{3}) (\d{2}) (\d{1,2}):(\d{2}) ([+-])(\d{2})(\d{2})\b/.exec(text);
  if (!m) return null;
  const [d, y, hh, mi, oh, om] = [m[1]!, m[3]!, m[4]!, m[5]!, m[7]!, m[8]!].map(Number) as [
    number, number, number, number, number, number,
  ];
  const mo = monthIndex(m[2]!) + 1;
  const year = 2000 + y;
  if (!validDate(year, mo, d) || hh > 23 || mi > 59 || oh > 14 || om > 59) return null;
  const offsetMin = (m[6] === '-' ? -1 : 1) * (oh * 60 + om);
  const local = new Date(Date.UTC(year, mo - 1, d, hh, mi) + (7 * 60 - offsetMin) * 60_000);
  const dateLocal = `${local.getUTCFullYear()}-${p2(local.getUTCMonth() + 1)}-${p2(local.getUTCDate())}`;
  return { occurredAtLocal: `${dateLocal}T${p2(local.getUTCHours())}:${p2(local.getUTCMinutes())}:00+07:00`, dateLocal };
}

/** `Picked up on 19 October 2026` и, если есть, первое время после «Your Trip» (`11:57AM`). */
function rideDateTime(text: string): { occurredAtLocal?: string; dateLocal: string } | null {
  const m = /Picked up on (\d{1,2}) ([A-Za-z]+) (\d{4})/.exec(text);
  if (!m) return null;
  const [d, y] = [Number(m[1]), Number(m[3])];
  const mo = monthIndex(m[2]!) + 1;
  if (!validDate(y, mo, d)) return null;
  const dateLocal = `${y}-${p2(mo)}-${p2(d)}`;
  const trip = text.indexOf('Your Trip');
  const t = trip >= 0 ? /\b(\d{1,2}):(\d{2}) ?(AM|PM)\b/.exec(text.slice(trip)) : null;
  if (!t) return { dateLocal };
  const h12 = Number(t[1]);
  const mi = Number(t[2]);
  if (h12 < 1 || h12 > 12 || mi > 59) return { dateLocal };
  const hh = (h12 % 12) + (t[3] === 'PM' ? 12 : 0);
  return { occurredAtLocal: `${dateLocal}T${p2(hh)}:${p2(mi)}:00+07:00`, dateLocal };
}

const AMOUNT = '(\\d[\\d.,]*)\\s*₫';

function parseFood(text: string, ctx: GrabParseContext): GrabParseResult {
  const orderId = /Mã đơn hàng\s+(A-[A-Z0-9]+)\b/.exec(text)?.[1];
  if (!orderId) return { ok: false, error: 'не разобран номер заказа' };
  const total = parseGrabAmount(new RegExp(`Tổng cộng\\s*${AMOUNT}`).exec(text)?.[1] ?? '');
  if (total === null) return { ok: false, error: 'не разобрана сумма' };
  // Регистр важен: «BẠN TRẢ» — строка итога, «Bạn trả bằng» — способ оплаты.
  const paid = parseGrabAmount(new RegExp(`BẠN TRẢ\\s*${AMOUNT}`).exec(text)?.[1] ?? '');
  if (paid === null) return { ok: false, error: 'нет строки «BẠN TRẢ»' };
  if (paid !== total) return { ok: false, error: 'итог и «BẠN TRẢ» различаются' };
  const dt = foodDateTime(text);
  if (!dt) return { ok: false, error: 'не разобрана дата' };
  return {
    ok: true,
    receipt: {
      source: 'grab-email',
      kind: 'food',
      service: 'GrabFood',
      gmailMessageId: ctx.gmailMessageId,
      orderId,
      ...dt,
      amount: total,
      currency: 'VND',
      paymentMethod: /Bạn trả bằng:?\s*(.+?)\s+Chi tiết/.exec(text)?.[1],
      merchant: /Đặt từ\s+(.+?)\s+Giao đến/.exec(text)?.[1],
    },
  };
}

function parseRide(text: string, ctx: GrabParseContext): GrabParseResult {
  const orderId = /Booking ID:\s*(A-[A-Z0-9]+)\b/.exec(text)?.[1];
  if (!orderId) return { ok: false, error: 'не разобран номер поездки' };
  const total = parseGrabAmount(new RegExp(`Total Paid\\s*${AMOUNT}`).exec(text)?.[1] ?? '');
  if (total === null) return { ok: false, error: 'не разобрана сумма' };
  const dt = rideDateTime(text);
  if (!dt) return { ok: false, error: 'не разобрана дата' };
  const head = text.slice(0, text.indexOf('Booking ID:'));
  return {
    ok: true,
    receipt: {
      source: 'grab-email',
      kind: 'ride',
      service: /\bGrab[A-Z][A-Za-z0-9]*/.exec(head)?.[0] ?? 'Grab',
      gmailMessageId: ctx.gmailMessageId,
      orderId,
      ...dt,
      amount: total,
      currency: 'VND',
      paymentMethod: /Paid by\s+(\D+?)\s+\d[\d.,]*/.exec(text)?.[1],
    },
  };
}

export function parseGrabReceiptCells(cells: string[], ctx: GrabParseContext): GrabParseResult {
  const text = cells.join(' ');
  if (text.includes('Mã đơn hàng') && text.includes('Đặt từ')) return parseFood(text, ctx);
  if (text.includes('Booking ID:') && text.includes('Picked up on')) return parseRide(text, ctx);
  return { ok: false, error: 'неизвестный вид чека Grab' };
}

export function parseGrabReceipt(html: string, ctx: GrabParseContext): GrabParseResult {
  return parseGrabReceiptCells(htmlToCells(html), ctx);
}
