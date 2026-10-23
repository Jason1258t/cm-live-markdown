import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { Prec, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { liveMarkdownKeymap } from './commands.ts';
import { liveMarkdownTheme } from './theme.ts';

/**
 * «Живой» Markdown, как Live Preview в Obsidian: текст остаётся Markdown, оформление рисуется поверх,
 * служебные символы видны только там, где стоит курсор. Без фокуса весь текст показан оформлённым.
 */

// ------------------------------------------------------------------ настройки

/** Свой строчный токен: всё, что совпало с регуляркой, вне курсора заменяется значком */
export interface InlineToken {
  /** Регулярка с флагом `g`; совпадения внутри кода не трогаются */
  pattern: RegExp;
  /** Значок вместо текста. Вызывается заново после `refreshLivePreview` */
  render: (match: RegExpExecArray, view: EditorView) => HTMLElement;
  /** Класс исходника токена под курсором (по умолчанию `lmd-token-src`) */
  sourceClass?: string;
}

export interface ImageOptions {
  /** Адрес для `<img>` по адресу из `![…](адрес)` — например, `file:<id>` → blob/https. По умолчанию как есть */
  resolve?: (src: string) => string | Promise<string>;
  /** Картинка ещё загружается — показать подпись `imageLoading` вместо `<img>` */
  pending?: (src: string) => boolean;
  /**
   * Вставили или бросили файлы-картинки: загрузить и вставить текст в позицию `pos`.
   * Вернуть `false` — не перехватывать (сработает обычная вставка).
   */
  onFiles?: (files: File[], pos: number, view: EditorView) => boolean | void;
  /** Какие файлы считать картинками (по умолчанию `type` начинается с `image/`) */
  accept?: (file: File) => boolean;
  /** Набор адресов картинок в тексте изменился (и при открытии) — чтобы показать их как вложения или убрать */
  onChange?: (srcs: string[]) => void;
}

export interface TableOptions {
  /**
   * Отрисовать таблицу (исходник с `|`) в `dom`. Можно вернуть функцию уборки — её вызовут, когда виджет уйдёт.
   * По умолчанию — простая встроенная таблица с текстом ячеек.
   */
  render?: (source: string, dom: HTMLElement) => void | (() => void);
}

/** Подписи. По умолчанию английские */
export interface Phrases {
  imageLoading: string;
  /** К подписи добавляется `: <alt>`, если он есть */
  imageNotFound: string;
  /** Подсказка над отрисованной таблицей */
  tableHint: string;
}

export const defaultPhrases: Phrases = {
  imageLoading: 'Loading image…',
  imageNotFound: 'Image not found',
  tableHint: 'Click to edit the table',
};

export interface LiveMarkdownOptions {
  /** Свои строчные токены: упоминания, предметы, теги */
  tokens?: readonly InlineToken[];
  /** Картинки `![…](…)`; `false` — показывать исходником */
  images?: ImageOptions | false;
  /** Таблицы вне курсора отрисованы; `false` — оставить текстом */
  tables?: TableOptions | false;
  phrases?: Partial<Phrases>;
  /** Язык Markdown (GFM) из @codemirror/lang-markdown. `false` — подключите свой `markdown()` сами */
  language?: boolean;
  /** Сочетания живого Markdown и продолжение списков по Enter (по умолчанию включены) */
  keymap?: boolean;
  /** Встроенное оформление (CSS-переменные `--lmd-*`). `false` — только своё */
  theme?: boolean;
  /** Ctrl/Cmd+клик по ссылке. По умолчанию — новая вкладка */
  openLink?: (url: string) => void;
}

/** Перерисовать токены и картинки — например, когда догрузился справочник для значков */
export const refreshLivePreview = StateEffect.define<null>();

// ------------------------------------------------------------------ виджеты

class TokenWidget extends WidgetType {
  readonly text: string;
  readonly match: RegExpExecArray;
  readonly token: InlineToken;
  readonly generation: number;
  constructor(match: RegExpExecArray, token: InlineToken, generation: number) {
    super();
    this.text = match[0];
    this.match = match;
    this.token = token;
    this.generation = generation;
  }
  eq(other: TokenWidget) {
    return other.text === this.text && other.token === this.token && other.generation === this.generation;
  }
  toDOM(view: EditorView) {
    return this.token.render(this.match, view);
  }
  ignoreEvent() {
    return false;
  }
}

class CheckboxWidget extends WidgetType {
  readonly checked: boolean;
  constructor(checked: boolean) {
    super();
    this.checked = checked;
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'lmd-check';
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

/** Маркер пункта вне курсора: «• •» по уровню вложенности или номер «3.1.» */
class ListMarkWidget extends WidgetType {
  readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  eq(other: ListMarkWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const mark = document.createElement('span');
    mark.className = 'lmd-bullet';
    mark.textContent = this.text;
    return mark;
  }
}

class ImageWidget extends WidgetType {
  readonly src: string;
  readonly alt: string;
  readonly opts: ImageOptions;
  readonly phrases: Phrases;
  readonly generation: number;
  constructor(src: string, alt: string, opts: ImageOptions, phrases: Phrases, generation: number) {
    super();
    this.src = src;
    this.alt = alt;
    this.opts = opts;
    this.phrases = phrases;
    this.generation = generation;
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.generation === this.generation;
  }
  toDOM() {
    const note = (text: string) => {
      const span = document.createElement('span');
      span.className = 'lmd-img-note';
      span.textContent = text;
      return span;
    };
    // Корень виджета не подменяем: CodeMirror принял бы новый узел за набранный текст и вписал подпись в документ
    const box = document.createElement('span');
    box.className = 'lmd-img-box';
    if (this.opts.pending?.(this.src)) {
      box.append(note(this.phrases.imageLoading));
      return box;
    }
    const img = document.createElement('img');
    img.className = 'lmd-img';
    img.alt = this.alt;
    const missing = () =>
      img.replaceWith(note(this.alt ? `${this.phrases.imageNotFound}: ${this.alt}` : this.phrases.imageNotFound));
    img.addEventListener('error', missing, { once: true });
    Promise.resolve()
      .then(() => (this.opts.resolve ? this.opts.resolve(this.src) : this.src))
      .then((url) => (img.src = url), missing);
    box.append(img);
    return box;
  }
  get estimatedHeight() {
    return 240;
  }
  ignoreEvent() {
    return false;
  }
}

// ------------------------------------------------------------------ списки

const isList = (n: SyntaxNode | null) => n?.name === 'BulletList' || n?.name === 'OrderedList';

/** Уровень пункта: сколько списков над ним (1 — верхний) */
function listDepth(item: SyntaxNode) {
  let depth = 0;
  for (let n: SyntaxNode | null = item.parent; n; n = n.parent) if (isList(n)) depth++;
  return depth;
}

/** Номер пункта: номер первого пункта списка + место среди соседей */
function itemNumber(state: EditorState, item: SyntaxNode) {
  const mark = item.parent?.firstChild?.getChild('ListMark');
  const start = mark ? parseInt(state.sliceDoc(mark.from, mark.to), 10) || 1 : 1;
  let index = 0;
  for (let n = item.prevSibling; n; n = n.prevSibling) if (n.name === 'ListItem') index++;
  return start + index;
}

/** «3.1.2.» — номера всех нумерованных пунктов-предков */
function outlineNumber(state: EditorState, item: SyntaxNode) {
  const parts: number[] = [];
  for (let n: SyntaxNode | null = item; n; n = n.parent)
    if (n.name === 'ListItem' && n.parent?.name === 'OrderedList') parts.unshift(itemNumber(state, n));
  return `${parts.join('.')}.`;
}

// ------------------------------------------------------------------ оформление по дереву

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

const INLINE: Record<string, string> = {
  Emphasis: 'lmd-em',
  StrongEmphasis: 'lmd-strong',
  Strikethrough: 'lmd-strike',
  InlineCode: 'lmd-code',
  Link: 'lmd-link',
};
const HIDDEN_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'LinkMark', 'URL']);

interface BuildContext {
  tokens: readonly InlineToken[];
  images: ImageOptions | false;
  phrases: Phrases;
  generation: number;
}

function build(view: EditorView, ctx: BuildContext): DecorationSet {
  const { state } = view;
  const sel = state.selection.ranges;
  // Без фокуса показываем всё оформлённым, как в просмотре
  const focused = view.hasFocus;
  /** Участок [from, to] задевает курсор/выделение — показываем исходник */
  const touched = (from: number, to: number) => focused && sel.some((r) => r.from <= to && r.to >= from);
  const activeLine = (pos: number) => {
    const l = state.doc.lineAt(pos);
    return touched(l.from, l.to);
  };

  // Декорации собираем списком и сортируем: дерево и регулярки идут вперемешку
  const out: { from: number; to: number; deco: Decoration }[] = [];
  const add = (from: number, to: number, deco: Decoration) => out.push({ from, to, deco });
  const addLine = (pos: number, deco: Decoration) => out.push({ from: pos, to: pos, deco });
  const codeRanges: [number, number][] = [];

  for (const { from, to } of view.visibleRanges) {
    // Токены не часть грамматики Markdown (парсер может увидеть в них ссылку) — ищем регулярками
    const text = state.sliceDoc(from, to);
    const found: { from: number; to: number; match: RegExpExecArray; token: InlineToken }[] = [];
    for (const token of ctx.tokens) {
      const re = new RegExp(
        token.pattern.source,
        token.pattern.flags.includes('g') ? token.pattern.flags : token.pattern.flags + 'g',
      );
      for (const m of text.matchAll(re)) {
        if (!m[0]) continue;
        const start = from + m.index;
        found.push({ from: start, to: start + m[0].length, match: m as RegExpExecArray, token });
      }
    }

    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (found.some((t) => node.from >= t.from && node.to <= t.to)) return false;
        const name = node.name;
        const parent = node.node.parent;

        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          addLine(state.doc.lineAt(node.from).from, line(`lmd-h lmd-h${heading[1]}`));
          return;
        }
        if (name === 'HeaderMark' && parent?.name.startsWith('ATXHeading')) {
          if (!activeLine(node.from)) {
            // Вместе с пробелом после #
            const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
            add(node.from, end, hide);
          }
          return;
        }
        if (name === 'Image') {
          const url = node.node.getChild('URL');
          if (ctx.images && url && !touched(node.from, node.to)) {
            const alt = state.sliceDoc(node.from + 2, Math.max(node.from + 2, url.from - 2));
            const widget = new ImageWidget(
              state.sliceDoc(url.from, url.to),
              alt,
              ctx.images,
              ctx.phrases,
              ctx.generation,
            );
            add(node.from, node.to, Decoration.replace({ widget }));
          }
          return;
        }
        if (INLINE[name]) {
          add(node.from, node.to, mark(INLINE[name]));
          if (name === 'InlineCode') codeRanges.push([node.from, node.to]);
          return;
        }
        if ((HIDDEN_MARKS.has(name) || (name === 'CodeMark' && parent?.name === 'InlineCode')) && parent) {
          if (!touched(parent.from, parent.to)) add(node.from, node.to, hide);
          return;
        }
        if (name === 'FencedCode' || name === 'CodeBlock') {
          codeRanges.push([node.from, node.to]);
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            addLine(l.from, line('lmd-codeblock'));
            pos = l.to + 1;
          }
          return false;
        }
        if (name === 'Blockquote') {
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            addLine(l.from, line('lmd-quote'));
            pos = l.to + 1;
          }
          return;
        }
        if (name === 'QuoteMark') {
          if (!activeLine(node.from)) add(node.from, Math.min(node.to + 1, state.doc.lineAt(node.from).to), hide);
          return;
        }
        if (name === 'HorizontalRule') {
          if (!activeLine(node.from)) {
            addLine(state.doc.lineAt(node.from).from, line('lmd-hr'));
            add(node.from, node.to, hide);
          }
          return;
        }
        if (name === 'Table') {
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            addLine(l.from, line('lmd-table'));
            pos = l.to + 1;
          }
          return;
        }
        if (name === 'ListMark' && parent && isList(parent.parent)) {
          if (activeLine(node.from)) return;
          // Пункт с чекбоксом: маркер списка прячем совсем, остаётся флажок
          if (parent.getChild('Task')) {
            add(node.from, Math.min(node.to + 1, state.doc.lineAt(node.from).to), hide);
            return;
          }
          const text =
            parent.parent!.name === 'BulletList'
              ? Array(listDepth(parent)).fill('•').join(' ')
              : outlineNumber(state, parent);
          add(node.from, node.to, Decoration.replace({ widget: new ListMarkWidget(text) }));
          return;
        }
        if (name === 'TaskMarker') {
          if (!touched(node.from, node.to)) {
            const checked = /x/i.test(state.sliceDoc(node.from, node.to));
            add(node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(checked) }));
            if (checked && parent) add(node.to, parent.to, mark('lmd-done'));
          }
          return;
        }
      },
    });

    for (const t of found) {
      if (codeRanges.some(([a, b]) => t.from >= a && t.to <= b)) continue;
      if (touched(t.from, t.to)) add(t.from, t.to, mark(t.token.sourceClass ?? 'lmd-token-src'));
      else add(t.from, t.to, Decoration.replace({ widget: new TokenWidget(t.match, t.token, ctx.generation) }));
    }
  }

  out.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  let lastHideEnd = -1;
  for (const d of out) {
    // Пересекающиеся замены RangeSetBuilder не любит — внутренние пропускаем
    const isReplace = d.from !== d.to && (d.deco.spec.widget || d.deco === hide);
    if (isReplace && d.from < lastHideEnd) continue;
    builder.add(d.from, d.to, d.deco);
    if (isReplace) lastHideEnd = d.to;
  }
  return builder.finish();
}

// ------------------------------------------------------------------ таблицы — отрисованная таблица вне курсора

/** Встроенная таблица: текст ячеек как есть, без разметки внутри */
function renderPlainTable(source: string, dom: HTMLElement) {
  const cells = (row: string) =>
    row
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'));
  const rows = source.split('\n').filter((r) => r.trim());
  const table = document.createElement('table');
  table.className = 'lmd-table-view';
  rows.forEach((row, i) => {
    if (i === 1 && /^\s*\|?[\s:|-]+\|?\s*$/.test(row)) return;
    const tr = document.createElement('tr');
    for (const text of cells(row)) {
      const cell = document.createElement(i === 0 ? 'th' : 'td');
      cell.textContent = text;
      tr.append(cell);
    }
    (i === 0 ? (table.createTHead() as HTMLElement) : (table.tBodies[0] ?? table.createTBody())).append(tr);
  });
  dom.append(table);
}

class TableWidget extends WidgetType {
  readonly text: string;
  readonly opts: TableOptions;
  readonly hint: string;
  constructor(text: string, opts: TableOptions, hint: string) {
    super();
    this.text = text;
    this.opts = opts;
    this.hint = hint;
  }
  eq(other: TableWidget) {
    return other.text === this.text;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'lmd-table-widget';
    dom.title = this.hint;
    const cleanup = (this.opts.render ?? renderPlainTable)(this.text, dom);
    if (cleanup) cleanups.set(dom, cleanup);
    // Клик — курсор в ту же строку исходника: таблица раскрывается в текст с |
    dom.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('a')) return;
      e.preventDefault();
      const rows = [...dom.querySelectorAll('tr')];
      const row = rows.indexOf((e.target as HTMLElement).closest('tr')!);
      // Строка-разделитель | --- | есть в исходнике, но не в таблице
      const lineOffset = row <= 0 ? 0 : row + 1;
      const first = view.state.doc.lineAt(view.posAtDOM(dom));
      const target = view.state.doc.line(Math.min(first.number + lineOffset, view.state.doc.lines));
      view.dispatch({ selection: { anchor: Math.min(target.from + 2, target.to) } });
      view.focus();
    });
    return dom;
  }
  destroy(dom: HTMLElement) {
    cleanups.get(dom)?.();
    cleanups.delete(dom);
  }
  get estimatedHeight() {
    return 32 * this.text.split('\n').length;
  }
  ignoreEvent() {
    return true;
  }
}

const cleanups = new WeakMap<HTMLElement, () => void>();

/** Фокус редактора — в состоянии, чтобы без фокуса таблицы были отрисованы, даже если курсор в них */
const setFocus = StateEffect.define<boolean>();

function buildTables(state: EditorState, focused: boolean, opts: TableOptions, hint: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table')
        return (
          node.name === 'Document' ||
          node.name.endsWith('List') ||
          node.name === 'ListItem' ||
          node.name === 'Blockquote'
        );
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      const inside = state.selection.ranges.some((r) => r.from <= to && r.to >= from);
      // Таблица внутри списка/цитаты — оставляем текстом: префиксы строк не часть таблицы
      if (from !== node.from) return false;
      if (!(focused && inside))
        builder.add(
          from,
          to,
          Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to), opts, hint), block: true }),
        );
      return false;
    },
  });
  return builder.finish();
}

function tablesField(opts: TableOptions, hint: string) {
  return StateField.define<{ focused: boolean; decos: DecorationSet }>({
    create: (state) => ({ focused: false, decos: buildTables(state, false, opts, hint) }),
    update(value, tr) {
      let focused = value.focused;
      for (const e of tr.effects) if (e.is(setFocus)) focused = e.value;
      if (
        focused === value.focused &&
        !tr.docChanged &&
        !tr.selection &&
        syntaxTree(tr.startState) === syntaxTree(tr.state)
      )
        return value;
      return { focused, decos: buildTables(tr.state, focused, opts, hint) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  });
}

// ------------------------------------------------------------------ картинки: вставка файлов и список адресов

const IMAGE_SRC = /!\[[^\]\n]*\]\(([^)\s]+)/g;

/** Адреса всех картинок `![…](адрес)` в тексте */
export const imageSources = (text: string) => [...text.matchAll(IMAGE_SRC)].map((m) => m[1]);

function imageExtensions(opts: ImageOptions): Extension[] {
  const accept = opts.accept ?? ((f: File) => f.type.startsWith('image/'));
  const take = (files: FileList | undefined | null, pos: number, view: EditorView, e: Event) => {
    const images = [...(files ?? [])].filter(accept);
    if (!images.length || !opts.onFiles) return false;
    if (opts.onFiles(images, pos, view) === false) return false;
    e.preventDefault();
    return true;
  };
  const out: Extension[] = [
    EditorView.domEventHandlers({
      paste: (e, view) => take(e.clipboardData?.files, view.state.selection.main.head, view, e),
      drop: (e, view) =>
        take(
          e.dataTransfer?.files,
          view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head,
          view,
          e,
        ),
    }),
  ];
  if (opts.onChange) {
    const onChange = opts.onChange;
    out.push(
      ViewPlugin.define((view) => {
        let last = imageSources(view.state.doc.toString());
        // После создания вида — колбэк может менять состояние приложения
        queueMicrotask(() => onChange(last));
        return {
          update(u: ViewUpdate) {
            if (!u.docChanged) return;
            const next = imageSources(u.state.doc.toString());
            if (next.join('\n') === last.join('\n')) return;
            last = next;
            onChange(next);
          },
        };
      }),
    );
  }
  return out;
}

// ------------------------------------------------------------------ сборка

/** Живой Markdown для CodeMirror 6 — одно расширение со всеми частями */
export function liveMarkdown(options: LiveMarkdownOptions = {}): Extension {
  const phrases: Phrases = { ...defaultPhrases, ...options.phrases };
  const tokens = options.tokens ?? [];
  const images = options.images === false ? false : (options.images ?? {});
  const openLink = options.openLink ?? ((url: string) => window.open(url, '_blank', 'noreferrer'));

  const preview = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      generation = 0;
      constructor(view: EditorView) {
        this.decorations = build(view, { tokens, images, phrases, generation: this.generation });
      }
      update(u: ViewUpdate) {
        const refresh = u.transactions.some((t) => t.effects.some((e) => e.is(refreshLivePreview)));
        if (refresh) this.generation++;
        if (
          u.docChanged ||
          u.selectionSet ||
          u.focusChanged ||
          u.viewportChanged ||
          refresh ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        )
          this.decorations = build(u.view, { tokens, images, phrases, generation: this.generation });
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(e, view) {
          const target = e.target as HTMLElement;
          if (target instanceof HTMLInputElement && target.classList.contains('lmd-check')) {
            const pos = view.posAtDOM(target);
            const text = view.state.sliceDoc(pos, pos + 3);
            if (/^\[[ xX]\]$/.test(text)) {
              view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: text[1] === ' ' ? 'x' : ' ' } });
              e.preventDefault();
              return true;
            }
          }
          // Ctrl/Cmd+клик по ссылке — открыть
          if (e.metaKey || e.ctrlKey) {
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos === null) return false;
            for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
              if (n.name !== 'Link') continue;
              const url = n.getChild('URL');
              if (url) openLink(view.state.sliceDoc(url.from, url.to));
              e.preventDefault();
              return true;
            }
          }
          return false;
        },
      },
    },
  );

  const ext: Extension[] = [];
  // Без markdown(): тот тянет подсветку HTML/CSS/JS (~100 КБ), а нужна только разметка
  if (options.language !== false) ext.push(markdownLanguage);
  if (options.keymap !== false)
    // Свои команды раньше стандартных: Tab/Shift+Tab — вложенность списков и ячейки таблиц, Backspace за маркером,
    // Ctrl+B/I/E/K, Ctrl+Enter — чекбокс; затем Enter продолжает список
    ext.push(Prec.high(keymap.of(liveMarkdownKeymap)), Prec.high(keymap.of(markdownKeymap)));
  ext.push(preview);
  if (options.tables !== false) {
    ext.push(
      tablesField(options.tables ?? {}, phrases.tableHint),
      EditorView.focusChangeEffect.of((_, focusing) => setFocus.of(focusing)),
    );
  }
  if (images) ext.push(imageExtensions(images));
  if (options.theme !== false) ext.push(liveMarkdownTheme);
  return ext;
}
