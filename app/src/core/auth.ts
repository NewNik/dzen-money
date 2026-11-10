// Проверка подлинности письма по заголовку Authentication-Results.
// Доверяем только самому верхнему заголовку, который поставил принимающий сервер Gmail:
// всё, что ниже, могло прийти вместе с письмом и подделывается отправителем.

export interface AuthResult {
  dkim: boolean;
  spf: boolean;
  dmarc: boolean;
}

const TRUSTED_AUTHSERV = 'mx.google.com';

/** Верхний заголовок Authentication-Results из сырого письма (с учётом переносов строк). */
export function topAuthResultsHeader(raw: string): string | null {
  const end = raw.search(/\r?\n\r?\n/);
  const head = (end >= 0 ? raw.slice(0, end) : raw).replace(/\r?\n[ \t]+/g, ' ');
  for (const line of head.split(/\r?\n/)) {
    const m = /^Authentication-Results:\s*(.*)$/i.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

const domainOf = (v: string): string => v.toLowerCase().replace(/^.*@/, '').replace(/[">]+$/, '');
const aligned = (domain: string, org: string): boolean => domain === org || domain.endsWith('.' + org);

/**
 * Разбирает значение заголовка. Результат засчитывается только если домен совпадает с orgDomain
 * или является его поддоменом: dkim — header.i/header.d, spf — smtp.mailfrom, dmarc — header.from.
 */
export function parseAuthResults(value: string | null, orgDomain: string): AuthResult {
  const res: AuthResult = { dkim: false, spf: false, dmarc: false };
  if (!value) return res;
  const parts = value.replace(/\([^)]*\)/g, ' ').split(';').map((p) => p.trim());
  if (parts[0]?.split(/\s+/)[0]?.toLowerCase() !== TRUSTED_AUTHSERV) return res;
  for (const part of parts.slice(1)) {
    const m = /^(dkim|spf|dmarc)=(\w+)\b(.*)$/i.exec(part);
    if (!m || m[2]!.toLowerCase() !== 'pass') continue;
    const props = new Map<string, string>();
    for (const kv of m[3]!.matchAll(/([\w.]+)=(\S+)/g)) props.set(kv[1]!.toLowerCase(), kv[2]!);
    const method = m[1]!.toLowerCase() as keyof AuthResult;
    const keys = method === 'dkim' ? ['header.i', 'header.d'] : method === 'spf' ? ['smtp.mailfrom'] : ['header.from'];
    if (keys.some((k) => props.has(k) && aligned(domainOf(props.get(k)!), orgDomain))) res[method] = true;
  }
  return res;
}

/**
 * Письмо подлинное, если DKIM банка и DMARC прошли. SPF не требуем:
 * при автопересылке из другого ящика он относится к пересылающему серверу.
 */
export const isTrusted = (a: AuthResult): boolean => a.dkim && a.dmarc;
