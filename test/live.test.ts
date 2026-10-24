import { markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { listMarker } from '../src/live.ts';

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
