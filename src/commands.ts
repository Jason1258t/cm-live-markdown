import { indentLess, indentMore } from '@codemirror/commands';
import { EditorSelection, type ChangeSpec, type EditorState, type StateCommand } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { KeyBinding } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { letterIndex, nextLetter } from './letters.ts';

/**
 * Команды «живого» Markdown: вложенность списков и сочетания оформления.
 * Все команды — StateCommand: работают и с EditorView, и с голым `{ state, dispatch }` (проверки на node).
 */

// ------------------------------------------------------------------ списки: Tab / Shift+Tab

/** Пункт списка: отступ, маркер (`-`, `*`, `+`, `1.`, `1)`, `a)`, `б)`), пробелы после него */
const LIST_LINE = /^(\s*)([-*+]|(\d+)([.)])|([a-zа-яё])(\)))(\s+)/i;

interface ListLine {
  indent: number;
  marker: string;
  /** Номер пункта; у буквенного — место буквы в алфавите (a, а — 1) */
  num?: number;
  delim?: string;
  /** Буква буквенного пункта */
  letter?: string;
  /** Колонка текста пункта — сюда встаёт отступ вложенного */
  content: number;
}

function parseList(text: string): ListLine | null {
  const m = LIST_LINE.exec(text);
  if (!m) return null;
  return {
    indent: m[1].length,
    marker: m[2],
    num: m[3] ? Number(m[3]) : m[5] ? letterIndex(m[5]) + 1 : undefined,
    delim: m[4] ?? m[6],
    letter: m[5],
    content: m[0].length,
  };
}

/** Маркер пункта того же вида с номером n: «3.» или «в)» */
const label = (item: ListLine, n: number) => `${item.letter ? nextLetter(item.letter, n - item.num!) : n}${item.delim}`;
/** Нумерация одного вида: цифры с цифрами, буквы с буквами */
const sameKind = (a: ListLine, b: ListLine) => !a.letter === !b.letter;

const indentOf = (text: string) => /^\s*/.exec(text)![0].length;

/**
 * Сдвиг пункта списка на строке `lineNo` (вместе с его вложенными строками).
 * dir = 1 — вложить под предыдущий пункт того же уровня, -1 — поднять на уровень родителя.
 * null — строка не пункт списка; [] — пункт, но сдвигать некуда.
 * Shift+Tab на верхнем уровне снимает разметку списка.
 */
function shiftItem(state: EditorState, lineNo: number, dir: 1 | -1): ChangeSpec[] | null {
  const doc = state.doc;
  const line = doc.line(lineNo);
  const item = parseList(line.text);
  if (!item) return null;

  let target = -1;
  let number: number | undefined;
  if (dir === 1) {
    // Ближайший пункт выше с отступом не больше нашего: того же уровня — вкладываемся под него
    for (let n = lineNo - 1; n >= 1; n--) {
      const text = doc.line(n).text;
      if (!text.trim()) continue;
      const prev = parseList(text);
      if (!prev) {
        if (indentOf(text) > item.indent) continue; // продолжение текста вложенного пункта
        break;
      }
      if (prev.indent > item.indent) continue;
      if (prev.indent === item.indent) target = prev.content;
      break;
    }
    if (target < 0) return [];
    // Нумерованный пункт в новом подсписке: продолжаем номер соседа на новом уровне или начинаем с 1
    if (item.num !== undefined) {
      number = 1;
      for (let n = lineNo - 1; n >= 1; n--) {
        const prev = parseList(doc.line(n).text);
        if (!prev || prev.indent < target) break;
        if (prev.indent === target && prev.num !== undefined && sameKind(prev, item)) {
          number = prev.num + 1;
          break;
        }
      }
    }
  } else {
    // Пункт верхнего уровня: Shift+Tab снимает разметку списка (и чекбокс) — строка становится обычным текстом
    if (item.indent === 0) {
      const task = /^\[[ xX]\]\s+/.exec(line.text.slice(item.content));
      return [{ from: line.from, to: line.from + item.content + (task ? task[0].length : 0) }];
    }
    target = 0;
    for (let n = lineNo - 1; n >= 1; n--) {
      const parent = parseList(doc.line(n).text);
      if (parent && parent.indent < item.indent) {
        target = parent.indent;
        if (item.num !== undefined && parent.num !== undefined && sameKind(parent, item)) number = parent.num + 1;
        break;
      }
    }
  }

  const delta = target - item.indent;
  const changes: ChangeSpec[] = [];
  const reindent = (n: number) => {
    const l = doc.line(n);
    const cur = indentOf(l.text);
    const next = Math.max(0, cur + delta);
    changes.push({ from: l.from, to: l.from + cur, insert: ' '.repeat(next) });
  };
  reindent(lineNo);
  if (number !== undefined) {
    const from = line.from + item.indent;
    changes.push({ from, to: from + item.marker.length, insert: label(item, number) });
  }
  // Вложенные строки пункта (отступ больше нашего) едут вместе с ним
  for (let n = lineNo + 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (!text.trim()) {
      const next = n < doc.lines ? doc.line(n + 1).text : '';
      if (indentOf(next) > item.indent && next.trim()) continue;
      break;
    }
    if (indentOf(text) <= item.indent) {
      // Поднятый пункт забирает следующих соседей себе в дети — нумерованный подсписок начинаем с 1
      const next = parseList(text);
      if (dir === -1 && next?.num !== undefined && next.indent === item.indent) {
        const l = doc.line(n);
        changes.push({
          from: l.from + next.indent,
          to: l.from + next.indent + next.marker.length,
          insert: label(next, 1),
        });
      }
      break;
    }
    reindent(n);
  }
  return changes;
}

/** Tab / Shift+Tab: сдвинуть пункты списка под курсором; не пункты — обычный отступ */
export function shiftLists(dir: 1 | -1): StateCommand {
  return (target) => {
    const { state } = target;
    const lines = new Set<number>();
    for (const r of state.selection.ranges) {
      const a = state.doc.lineAt(r.from).number;
      const b = state.doc.lineAt(r.to).number;
      for (let n = a; n <= b; n++) lines.add(n);
    }
    // Не пункты — обычный отступ
    const results = [...lines].map((n) => shiftItem(state, n, dir));
    if (results.every((r) => r === null)) return dir === 1 ? indentMore(target) : indentLess(target);
    // При выделении нескольких пунктов вложенные строки сдвигаются со своим пунктом — повторно не трогаем
    const seen = new Set<string>();
    const changes: ChangeSpec[] = [];
    for (const r of results)
      for (const c of r ?? []) {
        const { from, to } = c as { from: number; to: number };
        if (seen.has(`${from}:${to}`)) continue;
        seen.add(`${from}:${to}`);
        changes.push(c);
      }
    if (changes.length) target.dispatch(state.update({ changes, userEvent: 'input.indent', scrollIntoView: true }));
    return true;
  };
}

// ------------------------------------------------------------------ оформление: Ctrl+B / I / E / Shift+X, ссылка, чекбокс

/** Сколько символов `ch` подряд идёт от позиции pos (dir 1 — вправо, -1 — влево), не больше 3 */
function run(text: string, ch: string, from: number, dir: 1 | -1) {
  let n = 0;
  for (let i = dir === 1 ? from : from - 1; n < 3 && i >= 0 && i < text.length && text[i] === ch; i += dir) n++;
  return n;
}

/**
 * Метка уже стоит, если по краям столько символов: для `*` и `**` считаем серию звёздочек,
 * чтобы курсив и жирный не путались (`***x***` — оба, `**x**` — только жирный).
 */
function isOn(mark: string, n: number) {
  if (mark === '*') return n % 2 === 1;
  if (mark === '**') return n >= 2;
  return n >= mark.length;
}

/** Обернуть выделение меткой (`**`, `*`, `` ` ``, `~~`) или снять её, если выделение уже обёрнуто */
export function wrap(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const len = mark.length;
    const ch = mark[0];
    const doc = state.doc.toString();
    const tr = state.changeByRange((r) => {
      const outer = Math.min(run(doc, ch, r.from, -1), run(doc, ch, r.to, 1));
      if (isOn(mark, outer))
        return {
          changes: [
            { from: r.from - len, to: r.from },
            { from: r.to, to: r.to + len },
          ],
          range: EditorSelection.range(r.from - len, r.to - len),
        };
      const inner = state.sliceDoc(r.from, r.to);
      const innerRun = Math.min(run(inner, ch, 0, 1), run(inner, ch, inner.length, -1));
      if (inner.length >= 2 * len && isOn(mark, innerRun))
        return {
          changes: { from: r.from, to: r.to, insert: inner.slice(len, -len) },
          range: EditorSelection.range(r.from, r.to - 2 * len),
        };
      return {
        changes: [
          { from: r.from, insert: mark },
          { from: r.to, insert: mark },
        ],
        range: EditorSelection.range(r.from + len, r.to + len),
      };
    });
    dispatch(state.update(tr, { userEvent: 'input.format', scrollIntoView: true }));
    return true;
  };
}

/** Ctrl+K: [выделение](url) — курсор на адрес */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to);
    const isUrl = /^https?:\/\/\S+$/.test(text);
    const insert = isUrl ? `[](${text})` : `[${text}](https://)`;
    const cursor = isUrl ? r.from + 1 : r.from + text.length + 3;
    return {
      changes: { from: r.from, to: r.to, insert },
      range: isUrl ? EditorSelection.cursor(cursor) : EditorSelection.range(cursor, cursor + 'https://'.length),
    };
  });
  dispatch(state.update(tr, { userEvent: 'input.format', scrollIntoView: true }));
  return true;
};

const TASK = /^(\s*(?:[-*+]|\d+[.)]|[a-zа-яё]\))\s+)\[([ xX])\]/i;

/** Ctrl+Enter: переключить чекбокс; пункт без чекбокса или обычная строка — сделать чекбоксом */
export const toggleTask: StateCommand = ({ state, dispatch }) => {
  const lines = new Set<number>();
  for (const r of state.selection.ranges)
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) lines.add(n);
  const changes: ChangeSpec[] = [];
  for (const n of lines) {
    const line = state.doc.line(n);
    const task = TASK.exec(line.text);
    if (task) {
      const pos = line.from + task[1].length + 1;
      changes.push({ from: pos, to: pos + 1, insert: task[2] === ' ' ? 'x' : ' ' });
      continue;
    }
    const item = parseList(line.text);
    if (item) changes.push({ from: line.from + item.content, insert: '[ ] ' });
    else {
      const indent = indentOf(line.text);
      changes.push({ from: line.from + indent, insert: '- [ ] ' });
    }
  }
  dispatch(state.update({ changes, userEvent: 'input.format' }));
  return true;
};

// ------------------------------------------------------------------ таблицы: Tab / Shift+Tab — к соседней ячейке

/** Tab / Shift+Tab в строке таблицы: к соседней ячейке */
export function tableCell(dir: 1 | -1): StateCommand {
  return ({ state, dispatch }) => {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    if (!line.text.trimStart().startsWith('|')) return false;
    // Начала ячеек: позиции сразу после каждого «|», кроме последнего
    const starts: number[] = [];
    for (let i = 0; i < line.text.length; i++)
      if (line.text[i] === '|' && i < line.text.trimEnd().length - 1) starts.push(i + 1);
    const col = head - line.from;
    let target: number | undefined;
    if (dir === 1) target = starts.find((p) => p > col);
    else {
      // Начало текущей ячейки, затем предыдущая; в первой ячейке — остаёмся
      const cur = [...starts].reverse().find((p) => p <= col) ?? starts[0];
      target = [...starts].reverse().find((p) => p < cur) ?? cur;
    }
    if (target === undefined) {
      // За последней ячейкой — в первую ячейку следующей строки таблицы (через разделитель | --- |)
      let n = line.number + 1;
      while (n <= state.doc.lines && /^\s*\|[\s:|-]+\|\s*$/.test(state.doc.line(n).text)) n++;
      if (n > state.doc.lines || !state.doc.line(n).text.trimStart().startsWith('|')) return true;
      const next = state.doc.line(n);
      target = next.text.indexOf('|') + 1 + (next.from - line.from);
    }
    const pos = line.from + target;
    // Курсор после пробела в начале ячейки
    const skip = state.sliceDoc(pos, pos + 1) === ' ' ? 1 : 0;
    dispatch(state.update({ selection: { anchor: pos + skip }, scrollIntoView: true }));
    return true;
  };
}

/**
 * Backspace сразу за маркером пункта (и чекбоксом) — снять разметку целиком, как в Obsidian.
 * Стандартная команда превращает маркер в пробелы, и строка прилипает к пункту выше.
 */
export const deleteListMarker: StateCommand = ({ state, dispatch }) => {
  const r = state.selection.main;
  if (!r.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(r.head);
  const item = parseList(line.text);
  if (!item) return false;
  const task = /^\[[ xX]\]\s+/.exec(line.text.slice(item.content));
  const end = line.from + item.content + (task ? task[0].length : 0);
  if (r.head !== end) return false;
  dispatch(state.update({ changes: { from: line.from, to: end }, userEvent: 'delete.backward', scrollIntoView: true }));
  return true;
};

/**
 * Enter в буквенном пункте «б) …»: новый пункт «в) », следующие пункты сдвигаются по алфавиту.
 * В пустом пункте — снять маркер и закончить список. Цифры и «-» продолжает стандартный Enter из lang-markdown.
 */
export const continueLetterList: StateCommand = ({ state, dispatch }) => {
  const r = state.selection.main;
  if (!r.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(r.head);
  const item = parseList(line.text);
  if (!item?.letter || r.head < line.from + item.content) return false;
  // Только настоящий пункт списка: не код и не строка абзаца, которую список прервать не может
  let inList = false;
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(line.from + item.indent, 1); n; n = n.parent)
    if (n.name === 'LetterList') inList = true;
  if (!inList) return false;

  const task = /^\[[ xX]\]\s+/.exec(line.text.slice(item.content));
  const body = line.text.slice(item.content + (task ? task[0].length : 0));
  if (!body.trim()) {
    dispatch(state.update({ changes: { from: line.from, to: line.to }, userEvent: 'delete', scrollIntoView: true }));
    return true;
  }

  const spaces = line.text.slice(item.indent + item.marker.length, item.content);
  const rest = state.sliceDoc(r.head, line.to);
  const insert = `\n${' '.repeat(item.indent)}${label(item, item.num! + 1)}${spaces}${task ? '[ ] ' : ''}`;
  const changes: ChangeSpec[] = [{ from: r.head, to: r.head + rest.length - rest.trimStart().length, insert }];
  // Следующие пункты того же списка — на букву дальше; вложенные строки и пустые пропускаем
  let num = item.num! + 2;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    if (!l.text.trim() || indentOf(l.text) > item.indent) continue;
    const next = parseList(l.text);
    if (!next?.letter || next.indent !== item.indent || next.delim !== item.delim) break;
    const want = label(item, num++);
    if (next.marker !== want)
      changes.push({ from: l.from + next.indent, to: l.from + next.indent + next.marker.length, insert: want });
  }
  const sel = state.changes(changes).mapPos(r.head, 1);
  dispatch(state.update({ changes, selection: { anchor: sel }, userEvent: 'input', scrollIntoView: true }));
  return true;
};

/** Сочетания живого Markdown. Ставить с Prec.high — раньше стандартных Tab и Backspace */
export const liveMarkdownKeymap: readonly KeyBinding[] = [
  { key: 'Backspace', run: deleteListMarker },
  { key: 'Tab', run: tableCell(1), shift: tableCell(-1) },
  { key: 'Tab', run: shiftLists(1), shift: shiftLists(-1) },
  { key: 'Mod-b', run: wrap('**') },
  { key: 'Mod-i', run: wrap('*') },
  { key: 'Mod-e', run: wrap('`') },
  { key: 'Mod-Shift-x', run: wrap('~~') },
  { key: 'Mod-k', run: insertLink },
  { key: 'Mod-Enter', run: toggleTask },
  { key: 'Enter', run: continueLetterList },
];
