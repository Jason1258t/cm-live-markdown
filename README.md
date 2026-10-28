# cm-live-markdown

Живой Markdown для [CodeMirror 6](https://codemirror.net) — как Live Preview в Obsidian. Текст остаётся обычным Markdown, оформление рисуется поверх, а служебные символы видны только там, где стоит курсор. Без фокуса весь текст показан оформлённым, как в просмотре.

- Заголовки, **жирный**, _курсив_, `код`, ~~зачёркнутое~~, ссылки (Ctrl/Cmd+клик — открыть), цитаты, блоки кода, горизонтальная линия.
- Списки: маркеры «•», «• •» по уровню вложенности и нумерация «3.1.» — с тем разделителем, что набран в исходнике («1)» остаётся «1)», вложенный «1.1)»); чекбоксы `- [ ]` кликаются.
- Таблицы вне курсора отрисованы, клик по ячейке раскрывает исходник на нужной строке.
- Картинки `![подпись](адрес)` — свой преобразователь адреса, вставка и перетаскивание файлов.
- Свои строчные токены: упоминания, теги, ссылки на сущности — регулярка и функция отрисовки значка.
- Сочетания: Tab / Shift+Tab (вложенность пунктов, ячейки таблиц), Backspace за маркером снимает его целиком, Enter продолжает список, Ctrl/Cmd+B / I / E / K, Ctrl/Cmd+Shift+X, Ctrl/Cmd+Enter — чекбокс.
- Оформление — CSS-переменные, без привязки к дизайну сайта.

Ядро — набор расширений CodeMirror без React; к нему тонкая обёртка для React (`cm-live-markdown/react`).

## Установка

```bash
npm i cm-live-markdown @codemirror/state @codemirror/view @codemirror/language @codemirror/lang-markdown @codemirror/commands @lezer/common
```

Пакеты `@codemirror/*` — peer-зависимости: используется та же копия, что у вас в проекте. React (≥ 18) нужен только для `cm-live-markdown/react`. Пакет только ESM.

## Без React

```ts
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { liveMarkdown } from 'cm-live-markdown';

new EditorView({
  parent: document.querySelector('#editor')!,
  state: EditorState.create({
    doc: '# Привет\n\n- [ ] дело',
    extensions: [history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping, liveMarkdown()],
  }),
});
```

`liveMarkdown()` подключает язык Markdown (GFM), отрисовку, таблицы, сочетания и тему. Историю правок, базовые сочетания и перенос строк добавьте сами — как в примере.

## React

```tsx
import { useState } from 'react';
import { LiveMarkdown } from 'cm-live-markdown/react';

function Note() {
  const [text, setText] = useState('');
  return <LiveMarkdown value={text} onChange={setText} placeholder="Пишите…" lang="ru" />;
}
```

| свойство                                                     | что                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `value`, `onChange`                                          | текст; правки снаружи применяются кусочком, курсор не сбивается  |
| `onSelect(range)`                                            | выделение `[from, to]`                                           |
| `onBlur`                                                     | редактор потерял фокус                                           |
| `placeholder`, `autoFocus`, `maxLength`, `lang`, `className` | как у поля ввода                                                 |
| `onImages(files, pos)`                                       | вставили или бросили картинки; нет обработчика — обычная вставка |
| `onMediaChange(srcs)`                                        | набор адресов картинок в тексте изменился (и при открытии)       |
| `options`                                                    | настройки `liveMarkdown()` (ниже); читаются при создании         |
| `extensions`                                                 | ещё расширения CodeMirror                                        |

`ref` даёт `focus()`, `select(from, to?)` и `view` — сам `EditorView`.

Обёртка — `<div class="lmd">`, редактор внутри занимает всю её высоту. Чтобы поле прокручивалось, задайте высоту: `.lmd { height: 100%; }` в контейнере с высотой.

## Настройки

```ts
liveMarkdown({
  tokens: [mention], // свои строчные токены
  images: { resolve, pending, onFiles, accept, onChange }, // или false — картинки исходником
  tables: { render }, // или false — таблицы текстом
  phrases: {
    imageLoading: 'Загрузка картинки…',
    imageNotFound: 'Картинка не найдена',
    tableHint: 'Нажмите, чтобы править таблицу',
  },
  language: true, // false — подключите свой markdown()
  keymap: true, // false — без сочетаний
  theme: true, // false — только ваш CSS
  openLink: (url) => window.open(url, '_blank', 'noreferrer'),
});
```

### Свои токены

Всё, что совпало с регуляркой, вне курсора заменяется значком; под курсором видно исходник (класс `lmd-token-src`). Внутри кода токены не трогаются.

```ts
import { liveMarkdown, refreshLivePreview, type InlineToken } from 'cm-live-markdown';

const users = new Map<string, string>();

const mention: InlineToken = {
  pattern: /@\[([a-z0-9]+)\]/g,
  render: (m) => {
    const chip = document.createElement('span');
    chip.className = 'mention';
    chip.textContent = users.get(m[1]) ?? m[1];
    return chip;
  },
};

// Справочник догрузился — перерисовать значки
loadUsers().then((list) => {
  list.forEach((u) => users.set(u.id, u.name));
  view.dispatch({ effects: refreshLivePreview.of(null) });
});
```

### Картинки

```ts
liveMarkdown({
  images: {
    // file:<id> → адрес для <img>; может вернуть Promise. Ошибка — подпись «не найдена»
    resolve: (src) => (src.startsWith('file:') ? store.objectUrl(src.slice(5)) : src),
    // Пока файл грузится, в тексте стоит ![…](uploading:…) — показать подпись
    pending: (src) => src.startsWith('uploading:'),
    // Вставили или бросили файлы
    onFiles: (files, pos, view) => {
      upload(files).then((ids) =>
        view.dispatch({ changes: { from: pos, insert: ids.map((id) => `![](file:${id})`).join('\n') } }),
      );
    },
    // Список адресов картинок в тексте — например, чтобы удалить файлы, которых больше нет
    onChange: (srcs) => attachments.sync(srcs),
  },
});
```

### Таблицы

По умолчанию таблица рисуется простой встроенной `<table class="lmd-table-view">` с текстом ячеек. Чтобы ячейки были оформлены так же, как в вашем просмотре, отдайте свой рендерер; он может вернуть функцию уборки:

```tsx
import { createRoot } from 'react-dom/client';

liveMarkdown({
  tables: {
    render(source, dom) {
      const root = createRoot(dom);
      root.render(<Markdown source={source} />);
      return () => queueMicrotask(() => root.unmount()); // не посреди отрисовки React
    },
  },
});
```

Таблица внутри списка или цитаты остаётся текстом.

## Оформление

Встроенная тема настраивается CSS-переменными на редакторе или любом предке:

| переменная                                           | что                                      | по умолчанию                              |
| ---------------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `--lmd-bg`, `--lmd-text`                             | фон и текст                              | прозрачный, наследуется                   |
| `--lmd-muted`                                        | маркеры списков, цитаты, исходник токена | серый                                     |
| `--lmd-faint`                                        | зачёркнутое, выполненное, подсказка      | светло-серый                              |
| `--lmd-font`, `--lmd-font-size`, `--lmd-line-height` | шрифт текста                             | наследуется, 1.6                          |
| `--lmd-mono`                                         | шрифт кода и таблиц-исходников           | системный моноширинный                    |
| `--lmd-padding`                                      | поля                                     | `14px 16px`                               |
| `--lmd-code-bg`                                      | фон кода                                 | полупрозрачный серый                      |
| `--lmd-link`                                         | ссылки                                   | синий                                     |
| `--lmd-accent`                                       | цвет флажков                             | системный                                 |
| `--lmd-quote-border`, `--lmd-rule`                   | черта цитаты, линии и рамки таблиц       | полупрозрачный серый                      |
| `--lmd-selection`                                    | выделение                                | своё для светлой и тёмной темы CodeMirror |

```css
.lmd {
  --lmd-text: var(--text);
  --lmd-link: var(--brand);
  --lmd-font-size: 14px;
}
```

Классы для своего CSS: `lmd-h1`…`lmd-h6`, `lmd-strong`, `lmd-em`, `lmd-strike`, `lmd-code`, `lmd-link`, `lmd-codeblock`, `lmd-quote`, `lmd-hr`, `lmd-table`, `lmd-bullet`, `lmd-check`, `lmd-done`, `lmd-img-box`, `lmd-img`, `lmd-img-note`, `lmd-table-widget`, `lmd-token-src`.

## Команды отдельно

Команды — обычные `StateCommand` CodeMirror, их можно повесить на свои клавиши или кнопки:

```ts
import { keymap } from '@codemirror/view';
import { liveMarkdown, wrap, toggleTask, shiftLists } from 'cm-live-markdown';

const extensions = [
  liveMarkdown({ keymap: false }),
  keymap.of([
    { key: 'Mod-b', run: wrap('**') },
    { key: 'Alt-x', run: toggleTask },
    { key: 'Tab', run: shiftLists(1), shift: shiftLists(-1) },
  ]),
];
```

`wrap(mark)`, `insertLink`, `toggleTask`, `shiftLists(dir)`, `tableCell(dir)`, `deleteListMarker`, весь набор — `liveMarkdownKeymap`. Также есть `cm-live-markdown/commands` — только команды, без отрисовки.

## Разработка

```bash
npm i
npm test          # проверки команд на состояниях CodeMirror, без браузера
npm run demo      # демо-страница (Vite)
npm run build     # dist + типы
```

## Лицензия

MIT

### Разделители и тире

Отдельная строка `--- Подпись ---` показывает линию с подписью посередине.
Отдельное `--` между пробелами (или на границе строки) отображается как длинное тире `—`.
В коде, ссылках, таблицах и пользовательских токенах тире остаётся исходным.
Разметка раскрывается под курсором; сохранённый текст не меняется.
