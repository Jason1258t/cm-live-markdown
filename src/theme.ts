import { EditorView } from '@codemirror/view';

/**
 * Встроенное оформление. Всё настраивается CSS-переменными на редакторе или любом предке:
 *
 * | переменная | что |
 * | --- | --- |
 * | `--lmd-bg`, `--lmd-text` | фон и текст |
 * | `--lmd-muted`, `--lmd-faint` | маркеры списков и цитаты; зачёркнутое, выполненное, подсказка |
 * | `--lmd-font`, `--lmd-font-size`, `--lmd-line-height`, `--lmd-mono` | шрифты |
 * | `--lmd-padding` | поля текста |
 * | `--lmd-code-bg`, `--lmd-link`, `--lmd-accent` | фон кода, ссылки, флажки |
 * | `--lmd-quote-border`, `--lmd-rule` | черта цитаты, горизонтальная линия |
 * | `--lmd-selection` | выделение (по умолчанию разное для светлой и тёмной темы CodeMirror) |
 */
export const liveMarkdownTheme = EditorView.baseTheme({
  '&': {
    height: '100%',
    background: 'var(--lmd-bg, transparent)',
    color: 'var(--lmd-text, inherit)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--lmd-font, inherit)',
    fontSize: 'var(--lmd-font-size, inherit)',
    lineHeight: 'var(--lmd-line-height, 1.6)',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: 'var(--lmd-padding, 14px 16px)',
    caretColor: 'var(--lmd-text, currentColor)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--lmd-text, currentColor)' },
  '&light .cm-selectionBackground, &light.cm-focused .cm-selectionBackground, &light .cm-content ::selection': {
    background: 'var(--lmd-selection, #d7e1fb) !important',
  },
  '&dark .cm-selectionBackground, &dark.cm-focused .cm-selectionBackground, &dark .cm-content ::selection': {
    background: 'var(--lmd-selection, #34405c) !important',
  },
  '.cm-placeholder': { color: 'var(--lmd-faint, #999)' },

  // заголовки
  '.lmd-h': { fontWeight: '650', lineHeight: '1.3' },
  '.lmd-h1': { fontSize: '1.6em', paddingTop: '0.4em !important' },
  '.lmd-h2': { fontSize: '1.35em', paddingTop: '0.35em !important' },
  '.lmd-h3': { fontSize: '1.15em', paddingTop: '0.3em !important' },
  '.lmd-h4, .lmd-h5, .lmd-h6': { fontSize: '1em' },

  // строчное
  '.lmd-strong': { fontWeight: '650' },
  '.lmd-em': { fontStyle: 'italic' },
  '.lmd-strike, .lmd-done': { textDecoration: 'line-through', color: 'var(--lmd-faint, #999)' },
  '.lmd-code': {
    fontFamily: 'var(--lmd-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
    fontSize: '0.9em',
    background: 'var(--lmd-code-bg, rgba(127, 127, 127, 0.15))',
    borderRadius: '4px',
    padding: '1px 3px',
  },
  '.lmd-link': {
    color: 'var(--lmd-link, #3b73d9)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  '.lmd-token-src': {
    fontFamily: 'var(--lmd-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
    fontSize: '0.9em',
    color: 'var(--lmd-muted, #808080)',
  },

  // блоки
  '.lmd-codeblock': {
    fontFamily: 'var(--lmd-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
    fontSize: '0.93em',
    background: 'var(--lmd-code-bg, rgba(127, 127, 127, 0.15))',
    padding: '0 10px !important',
  },
  '.lmd-table': {
    fontFamily: 'var(--lmd-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
    fontSize: '0.93em',
  },
  '.lmd-quote': {
    borderLeft: '3px solid var(--lmd-quote-border, rgba(127, 127, 127, 0.5))',
    paddingLeft: '12px !important',
    color: 'var(--lmd-muted, #808080)',
  },
  '.lmd-hr': {
    height: '0.8em',
    background:
      'linear-gradient(var(--lmd-rule, rgba(127, 127, 127, 0.35)), var(--lmd-rule, rgba(127, 127, 127, 0.35))) center / 100% 1px no-repeat',
  },

  // списки
  '.lmd-bullet': {
    color: 'var(--lmd-muted, #808080)',
    display: 'inline-block',
    minWidth: '0.7em',
    fontVariantNumeric: 'tabular-nums',
  },
  '.lmd-check': {
    margin: '0 6px 0 0',
    verticalAlign: '-2px',
    cursor: 'pointer',
    accentColor: 'var(--lmd-accent, auto)',
  },

  // картинки
  '.lmd-img': { display: 'block', maxWidth: '100%', maxHeight: '480px', margin: '6px 0' },
  '.lmd-img-note': { color: 'var(--lmd-faint, #999)', fontStyle: 'italic' },

  // таблица, отрисованная вне курсора
  '.lmd-table-widget': { cursor: 'text', padding: '2px 0' },
  '.lmd-table-view': { borderCollapse: 'collapse' },
  '.lmd-table-view th, .lmd-table-view td': {
    border: '1px solid var(--lmd-rule, rgba(127, 127, 127, 0.35))',
    padding: '3px 8px',
    textAlign: 'left',
  },
});
