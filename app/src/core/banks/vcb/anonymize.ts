// Обезличивание HTML письма для фикстуры: структура и подписи сохраняются, значения затираются.
// Результат всё равно просмотреть глазами перед коммитом.
import { decodeEntities, normalizeText } from '../../html';
import { splitLabel } from './transfer-receipt';

const maskAll = (s: string): string => s.replace(/\p{L}/gu, 'x').replace(/\d/g, '0');
const maskDigits = (s: string): string =>
  s.replace(/[\w.+-]+@[\w.-]+/g, 'x@x.x').replace(/\d/g, '0');

export function anonymizeHtml(html: string): string {
  let afterLabel = false;
  let skip = false; // внутри <style>/<script>
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (/^<(style|script)\b/i.test(part)) skip = true;
        if (/^<\/(style|script)/i.test(part)) skip = false;
        return part.replace(/\b(href|src|alt|title)\s*=\s*("[^"]*"|'[^']*')/gi, '$1="#"');
      }
      if (skip) return part;
      const text = normalizeText(decodeEntities(part));
      if (!text) return part;
      const lab = splitLabel(text);
      if (lab) {
        afterLabel = !lab.inline;
        return lab.inline ? `${lab.head}: ${maskAll(lab.inline)}` : part;
      }
      if (afterLabel) {
        afterLabel = false;
        return maskAll(text);
      }
      return maskDigits(text);
    })
    .join('');
}
