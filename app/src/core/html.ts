// HTML → последовательность текстов «листовых» ячеек таблицы.
// Без DOM: в Apps Script его нет, ядро остаётся переносимым.

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Тексты ячеек <td>/<th>, не содержащих вложенных ячеек, в порядке документа. */
export function htmlToCells(html: string): string[] {
  const src = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const cells: string[] = [];
  const re = /<t[dh]\b[^>]*>((?:(?!<t[dh]\b)[\s\S])*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const text = decodeEntities((m[1] ?? '').replace(/<[^>]+>/g, ' '))
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) cells.push(text.normalize('NFC'));
  }
  return cells;
}
