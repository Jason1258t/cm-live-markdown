import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown';

/**
 * Буквенные списки «a) / b)» и «а) / б)» — расширение парсера Markdown (в CommonMark их нет).
 * Узлы: `LetterList` > `ListItem` > `ListMark` — как у обычных списков, только список свой.
 * Разделитель только «)»: «т. е.» в начале строки не должно стать списком.
 */

const LATIN = 'abcdefghijklmnopqrstuvwxyz';
/** Русский порядок пунктов — без ё, й, ъ, ы, ь */
const CYRILLIC = 'абвгдежзиклмнопрстуфхцчшщэюя';

/** Буква пункта, `)`, пробел или конец строки */
export const LETTER_MARK = /^([a-zа-яё])\)(?=\s|$)/i;

const alphabet = (letter: string) => (LATIN.includes(letter.toLowerCase()) ? LATIN : CYRILLIC);

/** Место буквы в своём алфавите с нуля (a, а — 0); буквы вне порядка (ё, й…) — -1 */
export const letterIndex = (letter: string) => alphabet(letter).indexOf(letter.toLowerCase());

/** Следующая буква пункта в том же алфавите и регистре; после последней — она же */
export function nextLetter(letter: string, add = 1) {
  const lower = letter.toLowerCase();
  const abc = alphabet(letter);
  const i = Math.max(0, abc.indexOf(lower));
  const next = abc[Math.max(0, Math.min(abc.length - 1, i + add))];
  return letter === lower ? next : next.toUpperCase();
}

/** Первая ли это буква алфавита (a / а) — только с неё список может прервать абзац, как «1.» в CommonMark */
const isFirst = (letter: string) => /^[aа]$/i.test(letter);

function markAt(line: Line) {
  return LETTER_MARK.exec(line.text.slice(line.pos));
}

function inLetterList(cx: BlockContext) {
  for (let d = cx.depth - 1; d >= 0; d--) if (cx.parentType(d).name === 'LetterList') return true;
  return false;
}

/** Отступ текста пункта, как getListIndent у lezer: 5+ пробелов после маркера — это код внутри пункта */
function contentColumn(line: Line, after: number) {
  const indentAfter = line.countIndent(after, line.pos, line.indent);
  const skipped = line.skipSpace(after);
  const indented = line.countIndent(skipped, after, indentAfter);
  return indented >= indentAfter + 5 || skipped === line.text.length ? indentAfter + 1 : indented;
}

export const letterLists: MarkdownConfig = {
  defineNodes: [
    {
      name: 'LetterList',
      block: true,
      // Список продолжается пустой строкой, вложенным в пункт текстом или следующим буквенным пунктом
      composite(_cx, line) {
        if (line.pos === line.text.length) return true;
        if (line.indent >= line.baseIndent + 3) return true;
        return !!markAt(line);
      },
    },
  ],
  parseBlock: [
    {
      name: 'LetterList',
      parse(cx, line) {
        if (line.indent >= line.baseIndent + 4 || !markAt(line)) return false;
        if (cx.parentType().name !== 'LetterList') cx.startComposite('LetterList', line.basePos);
        const col = contentColumn(line, line.pos + 2);
        cx.startComposite('ListItem', line.basePos, col - line.baseIndent);
        cx.addElement(cx.elt('ListMark', cx.lineStart + line.pos, cx.lineStart + line.pos + 2));
        line.moveBaseColumn(col);
        return null;
      },
      endLeaf(cx, line) {
        if (line.indent >= line.baseIndent + 4) return false;
        const m = markAt(line);
        if (!m) return false;
        // Пустой пункт абзац не прерывает (как в CommonMark)
        if (line.skipSpace(line.pos + 2) === line.text.length) return false;
        return isFirst(m[1]) || inLetterList(cx);
      },
      before: 'OrderedList',
    },
  ],
};
