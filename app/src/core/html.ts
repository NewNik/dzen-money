// HTML письма → последовательность текстовых ячеек.
// Регулярки вместо DOM: в Apps Script нет DOM, ядро должно оставаться переносимым.

const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Схлопывает пробелы (включая неразрывные), обрезает края, приводит к NFC. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\s ​﻿]+/g, ' ')
    .trim();
}

const BLOCK = /<\/?(?:td|th|tr|table|tbody|thead|p|div|br|li|ul|ol|h[1-6]|hr)\b[^>]*>/gi;

/** Границы ячеек — блочные теги и <br>. Переводы строк внутри ячейки — обычные пробелы. */
export function htmlToCells(html: string): string[] {
  const SEP = '\u0001';
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(BLOCK, SEP)
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .split(SEP)
    .map(normalizeText)
    .filter((c) => c !== '');
}

/** Для текстовой (не HTML) версии письма: ячейка — строка. */
export function textToCells(text: string): string[] {
  return text.split(/\r?\n/).map(normalizeText).filter((c) => c !== '');
}
