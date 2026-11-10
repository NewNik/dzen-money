// Нормализация текста для сравнения: нижний регистр, без диакритики.

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/ё/g, 'е')
    .replace(/й/g, '\u0000') // й не должна превратиться в и
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\u0000/g, 'й')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Имя получателя без суффикса «_цифры» и лишних пробелов. */
export function cleanBeneficiary(name: string): string {
  return name.replace(/_\d+$/, '').replace(/\s+/g, ' ').trim();
}

/** Маскирует номер счёта для логов: ****0851. */
export function maskAccount(acc: string | undefined): string {
  if (!acc) return '-';
  return '****' + acc.slice(-4);
}

/** Маскирует в произвольной строке все последовательности из 8+ цифр. */
export function maskDigits(s: string): string {
  return s.replace(/\d{8,}/g, (m) => '****' + m.slice(-4));
}
