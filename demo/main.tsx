import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { InlineToken } from '../src/index.ts';
import { LiveMarkdown } from '../src/react.tsx';

/** Демо: свой токен #тег, картинки из буфера (как blob-адреса), встроенные таблицы, русские подписи */

const tag: InlineToken = {
  pattern: /#[\p{L}\d_-]+/gu,
  render: (m) => {
    const el = document.createElement('span');
    el.className = 'tag';
    el.textContent = m[0].slice(1);
    return el;
  },
};

const START = `# Живой Markdown

Текст остаётся **Markdown**, а *оформление* рисуется поверх. Разметка видна только под курсором: \`код\`, ~~зачёркнутое~~, [ссылка](https://codemirror.net) (Ctrl+клик — открыть).

## Списки

- пункт
  - вложенный
    - ещё глубже
1. первый
   1. нумерация 1.1
   2. и 1.2
2. второй

- [ ] дело
- [x] сделано #готово

> Цитата

| Что | Сколько |
| --- | --- |
| Свои токены | #тег |
| Таблица | раскрывается по клику |

---

![пример](https://picsum.photos/seed/lmd/480/200)
`;

function App() {
  const [text, setText] = useState(START);
  const [media, setMedia] = useState<string[]>([]);
  return (
    <>
      <div className="editor">
        <LiveMarkdown
          value={text}
          onChange={setText}
          lang="ru"
          placeholder="Пишите…"
          options={{
            tokens: [tag],
            phrases: {
              imageLoading: 'Загрузка картинки…',
              imageNotFound: 'Картинка не найдена',
              tableHint: 'Нажмите, чтобы править таблицу',
            },
          }}
          onImages={(files, pos) => {
            const insert = files.map((f) => `![${f.name}](${URL.createObjectURL(f)})`).join('\n');
            setText((t) => t.slice(0, pos) + insert + t.slice(pos));
          }}
          onMediaChange={setMedia}
        />
      </div>
      <div className="row">Картинок в тексте: {media.length}</div>
      <pre>{text}</pre>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
