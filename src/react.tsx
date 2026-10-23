import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Annotation, EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { liveMarkdown, type LiveMarkdownOptions } from './live.ts';

/** Тонкая обёртка для React: управляемое поле `value` / `onChange` поверх `liveMarkdown()` */

export interface LiveMarkdownHandle {
  focus: () => void;
  /** Поставить курсор/выделение (позиции в исходнике) */
  select: (from: number, to?: number) => void;
  /** Сам EditorView — для своих команд */
  readonly view: EditorView | null;
}

export interface LiveMarkdownProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (range: [number, number]) => void;
  onBlur?: () => void;
  placeholder?: string;
  /** Вставили или бросили картинки — загрузить и вставить в позицию `pos`. Нет обработчика — обычная вставка */
  onImages?: (files: File[], pos: number) => void;
  /** Набор адресов картинок в тексте изменился (и при открытии) */
  onMediaChange?: (srcs: string[]) => void;
  autoFocus?: boolean;
  /** Предел длины текста: правки сверх него не принимаются */
  maxLength?: number;
  className?: string;
  /** Язык текста для проверки орфографии (`lang` у поля) */
  lang?: string;
  /**
   * Настройки живого Markdown. Читаются один раз при создании редактора;
   * `images.onFiles` / `images.onChange` здесь не нужны — для них `onImages` и `onMediaChange`
   */
  options?: LiveMarkdownOptions;
  /** Ещё расширения CodeMirror (читаются при создании) */
  extensions?: Extension[];
}

/** Правка пришла снаружи (props.value) — не отдавать её обратно в onChange */
const external = Annotation.define<boolean>();

/** Правка только изменившегося куска — чтобы чужие правки не сбивали курсор */
function diff(a: string, b: string) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return { from: s, to: a.length - e, insert: b.slice(s, b.length - e) };
}

export const LiveMarkdown = forwardRef<LiveMarkdownHandle, LiveMarkdownProps>(function LiveMarkdown(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef(props);
  /** Последний текст, отданный в onChange */
  const emitted = useRef(props.value);
  useLayoutEffect(() => {
    cb.current = props;
  });

  useEffect(() => {
    const { options = {}, lang } = cb.current;
    const images =
      options.images === false
        ? false
        : {
            ...options.images,
            // Колбэки — через ref: пропсы меняются, а редактор создаётся один раз
            onFiles: (files: File[], pos: number) => {
              if (!cb.current.onImages) return false;
              cb.current.onImages(files, pos);
            },
            onChange: (srcs: string[]) => cb.current.onMediaChange?.(srcs),
          };
    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      liveMarkdown({ ...options, images }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: 'true', ...(lang ? { lang } : {}) }),
      EditorView.updateListener.of((u) => {
        const fromOutside = u.transactions.some((t) => t.annotation(external));
        if (u.docChanged && !fromOutside) {
          emitted.current = u.state.doc.toString();
          cb.current.onChange(emitted.current);
        }
        if (u.selectionSet || u.docChanged) {
          const r = u.state.selection.main;
          cb.current.onSelect?.([r.from, r.to]);
        }
        if (u.focusChanged && !u.view.hasFocus) cb.current.onBlur?.();
      }),
      ...(cb.current.extensions ?? []),
    ];
    if (cb.current.placeholder) extensions.push(placeholderExt(cb.current.placeholder));
    const max = cb.current.maxLength;
    if (max)
      extensions.push(
        EditorState.changeFilter.of((tr) => tr.newDoc.length <= max || tr.newDoc.length <= tr.startState.doc.length),
      );
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: cb.current.value, extensions }),
    });
    view.current = v;
    if (cb.current.autoFocus) v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  // Текст поменялся снаружи (вставка, другой пользователь, агент)
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    // Наш же текст вернулся через родителя — не трогаем: редактор мог уже уйти вперёд (быстрый ввод)
    if (props.value === emitted.current) return;
    const cur = v.state.doc.toString();
    emitted.current = props.value;
    if (cur !== props.value) v.dispatch({ changes: diff(cur, props.value), annotations: external.of(true) });
  }, [props.value]);

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    select: (from, to = from) => {
      const v = view.current;
      if (!v) return;
      const len = v.state.doc.length;
      v.dispatch({ selection: EditorSelection.single(Math.min(from, len), Math.min(to, len)), scrollIntoView: true });
    },
    get view() {
      return view.current;
    },
  }));

  return <div ref={host} className={props.className ? `lmd ${props.className}` : 'lmd'} />;
});

export default LiveMarkdown;
