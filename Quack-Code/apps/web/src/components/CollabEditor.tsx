import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, indentLess, indentMore } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { User } from '@quack/shared';
import { useCollab } from '../collab/useCollab';
import { StatusBar } from './StatusBar';

async function languageFor(path: string): Promise<Extension> {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': case 'jsx':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true });
    case 'ts': case 'tsx':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true });
    case 'py':
      return (await import('@codemirror/lang-python')).python();
    case 'json':
      return (await import('@codemirror/lang-json')).json();
    case 'html': case 'htm':
      return (await import('@codemirror/lang-html')).html();
    case 'css':
      return (await import('@codemirror/lang-css')).css();
    case 'md': case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown();
    default:
      return [];
  }
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/**
 * Tab indents, which would trap keyboard users. Pressing Escape first releases the next Tab
 * so focus can leave the editor (documented in the shortcuts dialog).
 */
function focusEscape(): Extension {
  let released = false;
  const run = (cmd: typeof indentMore) => (view: EditorView) => {
    if (released) {
      released = false;
      return false;
    }
    return cmd(view);
  };
  return [
    keymap.of([
      { key: 'Escape', run: () => ((released = true), false) },
      { key: 'Tab', run: run(indentMore), shift: run(indentLess) },
    ]),
    EditorView.domEventHandlers({
      keydown: (e) => {
        if (e.key !== 'Escape' && e.key !== 'Tab') released = false;
        return false;
      },
    }),
  ];
}

export function CollabEditor({ fileId, path, me }: { fileId: string; path: string; me: User }) {
  const collab = useCollab(fileId, me);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const theme = useRef(new Compartment());
  const readOnly = useRef(new Compartment());

  const ready = collab !== null;
  useEffect(() => {
    if (!collab || !host.current) return;
    const mq = darkQuery();
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: collab.ytext.toString(),
        extensions: [
          lineNumbers(),
          foldGutter(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          focusEscape(),
          keymap.of([
            ...closeBracketsKeymap,
            ...yUndoManagerKeymap, // per-user undo/redo: never reverts a collaborator's change
            ...searchKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...defaultKeymap,
          ]),
          yCollab(collab.ytext, collab.awareness, { undoManager: collab.undoManager }),
          lang.current.of([]),
          theme.current.of(mq.matches ? oneDark : []),
          readOnly.current.of([]),
          EditorView.contentAttributes.of({ 'aria-label': `Editor for ${path}`, 'aria-multiline': 'true' }),
        ],
      }),
    });
    viewRef.current = view;
    const onScheme = () => view.dispatch({ effects: theme.current.reconfigure(mq.matches ? oneDark : []) });
    mq.addEventListener('change', onScheme);
    return () => {
      mq.removeEventListener('change', onScheme);
      view.destroy();
      viewRef.current = null;
    };
    // path only feeds an aria-label; the editor must not be rebuilt when it changes.
  }, [collab?.ytext]);

  useEffect(() => {
    let cancelled = false;
    void languageFor(path).then((ext) => {
      if (!cancelled) viewRef.current?.dispatch({ effects: lang.current.reconfigure(ext) });
    });
    return () => {
      cancelled = true;
    };
  }, [path, ready]);

  const isReadOnly = collab?.role !== undefined && collab.role !== null && collab.role === 'viewer';
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnly.current.reconfigure(isReadOnly ? EditorState.readOnly.of(true) : []),
    });
  }, [isReadOnly, ready]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <StatusBar collab={collab} readOnly={isReadOnly} path={path} />
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}
