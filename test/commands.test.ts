import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  continueLetterList,
  deleteListMarker,
  insertLink,
  shiftLists,
  tableCell,
  toggleTask,
  wrap,
} from '../src/commands.ts';
import { imageSources, liveMarkdownLanguage } from '../src/live.ts';

/**
 * Проверки команд на состояниях CodeMirror, без браузера.
 * В тексте `^` — курсор, `<…>` — выделение.
 */
function state(text: string) {
  const sel = text.indexOf('<');
  if (sel >= 0) {
    const end = text.indexOf('>') - 1;
    const doc = text.replace('<', '').replace('>', '');
    return EditorState.create({ doc, selection: EditorSelection.single(sel, end), extensions: liveMarkdownLanguage });
  }
  const head = text.indexOf('^');
  return EditorState.create({
    doc: text.replace('^', ''),
    selection: { anchor: head },
    extensions: liveMarkdownLanguage,
  });
}

function show(s: EditorState) {
  const r = s.selection.main;
  const doc = s.doc.toString();
  if (r.empty) return doc.slice(0, r.head) + '^' + doc.slice(r.head);
  return doc.slice(0, r.from) + '<' + doc.slice(r.from, r.to) + '>' + doc.slice(r.to);
}

/** Выполнить команду: результат (как текст с курсором) и вернула ли она true */
function run(cmd: StateCommand, text: string) {
  let s = state(text);
  const handled = cmd({ state: s, dispatch: (tr: Transaction) => (s = tr.state) });
  return { text: show(s), handled };
}

const apply = (cmd: StateCommand, text: string) => run(cmd, text).text;

describe('Tab / Shift+Tab в списках', () => {
  test('вложить пункт под предыдущий', () => {
    assert.equal(apply(shiftLists(1), '- a\n- b^'), '- a\n  - b^');
  });
  test('первый пункт вложить некуда — ничего не меняется, но Tab съеден', () => {
    const r = run(shiftLists(1), '- a^\n- b');
    assert.equal(r.text, '- a^\n- b');
    assert.equal(r.handled, true);
  });
  test('нумерованный: вложенный начинается с 1', () => {
    assert.equal(apply(shiftLists(1), '1. a\n2. b^'), '1. a\n   1. b^');
  });
  test('нумерованный: продолжает номер соседа на новом уровне', () => {
    assert.equal(apply(shiftLists(1), '1. a\n   1. x\n2. b^'), '1. a\n   1. x\n   2. b^');
  });
  test('вложенные строки едут вместе с пунктом', () => {
    assert.equal(apply(shiftLists(1), '- a\n- b^\n  - c\n- d'), '- a\n  - b^\n    - c\n- d');
  });
  test('Shift+Tab поднимает на уровень родителя', () => {
    assert.equal(apply(shiftLists(-1), '- a\n  - b^'), '- a\n- b^');
  });
  test('Shift+Tab: номер продолжает родителя, соседи ниже становятся детьми с 1', () => {
    assert.equal(apply(shiftLists(-1), '1. a\n   1. b^\n   2. c'), '1. a\n2. b^\n   1. c');
  });
  test('Shift+Tab на верхнем уровне снимает маркер и чекбокс', () => {
    assert.equal(apply(shiftLists(-1), '- [ ] дело^'), 'дело^');
  });
  test('не список — обычный отступ', () => {
    assert.equal(apply(shiftLists(1), 'текст^'), '  текст^');
  });
});

describe('буквенные списки', () => {
  test('Enter — следующая буква, текст после курсора уходит в новый пункт', () => {
    assert.equal(apply(continueLetterList, 'а) раз^'), 'а) раз\nб) ^');
    assert.equal(apply(continueLetterList, 'a) раз^два'), 'a) раз\nb) ^два');
    assert.equal(apply(continueLetterList, 'A) раз^'), 'A) раз\nB) ^');
  });
  test('Enter посреди списка сдвигает следующие буквы', () => {
    assert.equal(apply(continueLetterList, 'а) раз^\nб) два\nв) три'), 'а) раз\nб) ^\nв) два\nг) три');
  });
  test('Enter во вложенном и с чекбоксом', () => {
    assert.equal(apply(continueLetterList, '1. раз\n   а) [ ] под^'), '1. раз\n   а) [ ] под\n   б) [ ] ^');
  });
  test('Enter в пустом пункте заканчивает список', () => {
    assert.equal(apply(continueLetterList, 'а) раз\nб) ^'), 'а) раз\n^');
  });
  test('не буквенный пункт и строка абзаца — не наше дело', () => {
    assert.equal(run(continueLetterList, '1. раз^').handled, false);
    assert.equal(run(continueLetterList, 'Текст\nб) дальше^').handled, false);
  });
  test('Tab вкладывает буквенный пункт и начинает с «а)»', () => {
    assert.equal(apply(shiftLists(1), '1. раз\n2. ^два'), '1. раз\n   1. ^два');
    assert.equal(apply(shiftLists(1), 'а) раз\nб) ^два'), 'а) раз\n   а) ^два');
  });
  test('Backspace за буквой снимает маркер', () => {
    assert.equal(apply(deleteListMarker, 'а) ^раз'), '^раз');
  });
});

describe('Backspace за маркером', () => {
  test('снимает маркер целиком', () => {
    assert.equal(apply(deleteListMarker, 'a\n- ^b'), 'a\n^b');
  });
  test('снимает маркер с чекбоксом', () => {
    assert.equal(apply(deleteListMarker, '  - [x] ^b'), '^b');
  });
  test('в середине текста — не перехватывает', () => {
    assert.equal(run(deleteListMarker, '- ab^c').handled, false);
  });
});

describe('оформление', () => {
  test('Ctrl+B оборачивает выделение', () => {
    assert.equal(apply(wrap('**'), 'a <b> c'), 'a **<b>** c');
  });
  test('Ctrl+B снимает жирный снаружи выделения', () => {
    assert.equal(apply(wrap('**'), 'a **<b>** c'), 'a <b> c');
  });
  test('Ctrl+B снимает жирный, если он внутри выделения', () => {
    assert.equal(apply(wrap('**'), 'a <**b**> c'), 'a <b> c');
  });
  test('Ctrl+I внутри жирного добавляет курсив, а не снимает жирный', () => {
    assert.equal(apply(wrap('*'), '**<b>**'), '***<b>***');
  });
  test('Ctrl+I снимает курсив у ***x***, жирный остаётся', () => {
    assert.equal(apply(wrap('*'), '***<b>***'), '**<b>**');
  });
  test('пустое выделение — метка вокруг курсора', () => {
    assert.equal(apply(wrap('`'), 'a ^'), 'a `^`');
  });
  test('Ctrl+Shift+X — зачёркнутое', () => {
    assert.equal(apply(wrap('~~'), '<x>'), '~~<x>~~');
  });
  test('Ctrl+K: текст становится ссылкой, адрес выделен', () => {
    assert.equal(apply(insertLink, '<сайт>'), '[сайт](<https://>)');
  });
  test('Ctrl+K: выделен адрес — курсор на подпись', () => {
    assert.equal(apply(insertLink, '<https://x.ru>'), '[^](https://x.ru)');
  });
});

describe('Ctrl+Enter — чекбокс', () => {
  test('обычная строка становится чекбоксом', () => {
    assert.equal(apply(toggleTask, 'дело^'), '- [ ] дело^');
  });
  test('пункт списка получает чекбокс', () => {
    assert.equal(apply(toggleTask, '1. дело^'), '1. [ ] дело^');
  });
  test('чекбокс переключается', () => {
    assert.equal(apply(toggleTask, '- [ ] дело^'), '- [x] дело^');
    assert.equal(apply(toggleTask, '- [X] дело^'), '- [ ] дело^');
  });
});

describe('Tab в таблице', () => {
  const t = (row1: string, row3 = '| c | d |') => `${row1}\n| --- | --- |\n${row3}`;
  test('к следующей ячейке', () => {
    assert.equal(apply(tableCell(1), t('| a^ | b |')), t('| a | ^b |'));
  });
  test('из последней ячейки — в первую ячейку следующей строки, через разделитель', () => {
    assert.equal(apply(tableCell(1), t('| a | b^ |')), t('| a | b |', '| ^c | d |'));
  });
  test('Shift+Tab — к предыдущей ячейке', () => {
    assert.equal(apply(tableCell(-1), t('| a | b^ |')), t('| ^a | b |'));
  });
  test('не таблица — не перехватывает', () => {
    assert.equal(run(tableCell(1), 'текст^').handled, false);
  });
});

test('imageSources находит адреса картинок', () => {
  assert.deepEqual(imageSources('![a](file:1) текст ![](https://x/y.png) [не картинка](z)'), [
    'file:1',
    'https://x/y.png',
  ]);
});
