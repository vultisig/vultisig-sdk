/**
 * Homoglyphs scammers substitute into a jetton symbol so it *reads* like a
 * verified one while differing byte-for-byte: Cyrillic/Greek capitals that look
 * like Latin ones, the tugrik sign standing in for `T`, and stroked `D`s. Keys
 * are already upper-cased because the map is applied after `toUpperCase()`.
 */
const confusables: Record<string, string> = {
  // Cyrillic
  А: 'A',
  В: 'B',
  Е: 'E',
  Ё: 'E',
  Ѕ: 'S',
  І: 'I',
  Ј: 'J',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
  Ԛ: 'Q',
  Ԝ: 'W',
  // Greek
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  // Currency and stroked letters
  '₮': 'T',
  Đ: 'D',
  Ð: 'D',
  Ɖ: 'D',
  Ŧ: 'T',
}

const combiningMarks = /[̀-ͯ]/g

/**
 * Collapses a jetton symbol or name to the Latin skeleton a user perceives, so
 * `USD₮`, `UЅDT` (Cyrillic Ѕ), `$USĐ₮` and `usdt` all compare equal to `USDT`.
 * Compatibility decomposition folds full-width and mathematical letter forms,
 * diacritics are dropped, known homoglyphs are mapped, and everything that is
 * not `A–Z`/`0–9` is removed. Returns an empty string when nothing survives.
 */
export const normalizeJettonSymbol = (value: string): string =>
  Array.from(value.normalize('NFKD').replace(combiningMarks, '').toUpperCase())
    .map(char => confusables[char] ?? char)
    .join('')
    .replace(/[^A-Z0-9]/g, '')
