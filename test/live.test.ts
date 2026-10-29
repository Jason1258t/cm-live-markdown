import { markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isPlainBrackets, listMarker } from '../src/live.ts';

/** Тексты маркеров пунктов по порядку — как их увидит редактор вне курсора */
function markers(doc: string) {
  const state = EditorState.create({ doc, extensions: markdownLanguage });
  const out: string[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === 'ListItem') out.push(listMarker(state, n.node));
    },
  });
  return out;
}

describe('маркер пункта вне курсора', () => {
  test('нумерованный с точкой', () => {
    assert.deepEqual(markers('1. раз\n2. два'), ['1.', '2.']);
  });
  test('«1)» остаётся со скобкой — как набрал пользователь', () => {
    assert.deepEqual(markers('1) раз\n2) два'), ['1)', '2)']);
  });
  test('вложенный: уровни через точку, у своего уровня — своя скобка', () => {
    assert.deepEqual(markers('1. раз\n   1) подпункт\n2. два'), ['1.', '1.1)', '2.']);
  });
  test('маркированный: точки по уровню вложенности', () => {
    assert.deepEqual(markers('- раз\n  - два'), ['•', '• •']);
  });
});

/** Для каждой ссылки/картинки документа: обычный ли это текст в скобках */
function plain(doc: string) {
  const state = EditorState.create({ doc, extensions: markdownLanguage });
  const out: boolean[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === 'Link' || n.name === 'Image') out.push(isPlainBrackets(state, n.node));
    },
  });
  return out;
}

describe('скобки без адреса — обычный текст', () => {
  test('[текст] и ![подпись] без адреса', () => {
    assert.deepEqual(plain('a [ text, that marks as url ] b'), [true]);
    assert.deepEqual(plain('![подпись]'), [true]);
    assert.deepEqual(plain('[a][] и [a][b]'), [true, true]);
  });
  test('ссылка и картинка с адресом остаются ссылкой', () => {
    assert.deepEqual(plain('[a](https://x.y) ![b](file:1)'), [false, false]);
  });
  test('ссылка на сноску — ссылка', () => {
    assert.deepEqual(plain('[Сайт] и [тут][сайт]\n\n[сайт]: https://x.y'), [false, false]);
  });
  test('экранированные скобки — не ссылка', () => {
    assert.deepEqual(plain('\\[a\\]'), []);
  });
});
