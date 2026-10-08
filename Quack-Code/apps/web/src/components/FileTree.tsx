import { Fragment, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { MAX_DOC_CHARS, filePathSchema, type FileNode } from '@quack/shared';
import { Button, ErrorNote, Field, Modal } from './ui';

interface TreeNode {
  file: FileNode;
  name: string;
  children: TreeNode[];
}

function buildTree(files: FileNode[]): TreeNode[] {
  const byPath = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const node: TreeNode = { file, name: file.path.split('/').pop()!, children: [] };
    byPath.set(file.path, node);
    const parent = file.path.includes('/') ? byPath.get(file.path.slice(0, file.path.lastIndexOf('/'))) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(b.file.kind === 'folder') - Number(a.file.kind === 'folder') || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

interface Row {
  node: TreeNode;
  depth: number;
  parent: Row | null;
}

function flatten(nodes: TreeNode[], expanded: Set<string>, depth = 0, parent: Row | null = null, out: Row[] = []) {
  for (const node of nodes) {
    const row: Row = { node, depth, parent };
    out.push(row);
    if (node.file.kind === 'folder' && expanded.has(node.file.path)) flatten(node.children, expanded, depth + 1, row, out);
  }
  return out;
}

type Dialog =
  | { type: 'create'; kind: 'file' | 'folder'; initial: string }
  | { type: 'rename'; file: FileNode }
  | { type: 'delete'; file: FileNode }
  | null;

interface Props {
  files: FileNode[];
  activeId: string | null;
  canWrite: boolean;
  onOpen: (id: string) => void;
  onCreate: (path: string, kind: 'file' | 'folder') => Promise<unknown>;
  onUpload: (path: string, content: string) => Promise<unknown>;
  onMove: (id: string, path: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

export function FileTree({ files, activeId, canWrite, onOpen, onCreate, onUpload, onMove, onDelete }: Props) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ ok: boolean; lines: string[] } | null>(null);

  const rows = useMemo(() => flatten(tree, expanded), [tree, expanded]);
  const tabStop = rows.find((r) => r.node.file.path === focusPath) ?? rows.find((r) => r.node.file.id === activeId) ?? rows[0];

  const focusRow = (row: Row | undefined) => {
    if (!row) return;
    setFocusPath(row.node.file.path);
    itemRefs.current.get(row.node.file.path)?.focus();
  };
  const toggle = (path: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(path)) next.add(path);
      else next.delete(path);
      return next;
    });
  const activate = (row: Row) => (row.node.file.kind === 'folder' ? toggle(row.node.file.path) : onOpen(row.node.file.id));

  const openDialog = (d: Dialog) => {
    setError(null);
    setBusy(false);
    setValue(d?.type === 'create' ? d.initial : d?.type === 'rename' ? d.file.path : '');
    setDialog(d);
  };
  // The item the toolbar acts on: the one last focused or clicked, else the open file.
  const selected = rows.find((r) => r.node.file.path === focusPath)?.node.file ?? files.find((f) => f.id === activeId) ?? null;
  /** Folder prefix that new or uploaded files go into: the selected folder, or the selected file's folder. */
  const targetPrefix = () => {
    if (!selected) return '';
    if (selected.kind === 'folder') return `${selected.path}/`;
    return selected.path.includes('/') ? `${selected.path.slice(0, selected.path.lastIndexOf('/'))}/` : '';
  };
  const startCreate = (kind: 'file' | 'folder') => openDialog({ type: 'create', kind, initial: targetPrefix() });

  const importFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const prefix = targetPrefix();
    const problems: string[] = [];
    let imported = 0;
    for (const file of Array.from(list)) {
      const path = prefix + file.name;
      if (!filePathSchema.safeParse(path).success) {
        problems.push(`${file.name}: the name may only use letters, numbers, spaces and . _ -`);
        continue;
      }
      if (file.size > MAX_DOC_CHARS * 4) {
        problems.push(`${file.name}: too large (the limit is ${MAX_DOC_CHARS.toLocaleString()} characters)`);
        continue;
      }
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        problems.push(`${file.name}: not a text file`);
        continue;
      }
      if (text.length > MAX_DOC_CHARS || text.includes(String.fromCharCode(0))) {
        problems.push(`${file.name}: ${text.length > MAX_DOC_CHARS ? 'too large' : 'not a text file'}`);
        continue;
      }
      try {
        await onUpload(path, text);
        imported++;
      } catch (err) {
        problems.push(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
      }
    }
    if (prefix) toggle(prefix.slice(0, -1), true);
    if (fileInput.current) fileInput.current.value = '';
    setNotice({
      ok: problems.length === 0,
      lines: [imported ? `Imported ${imported} file${imported === 1 ? '' : 's'}.` : 'Nothing was imported.', ...problems],
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const i = rows.findIndex((r) => r === tabStop);
    const row = rows[i];
    if (!row) return;
    const isFolder = row.node.file.kind === 'folder';
    switch (e.key) {
      case 'ArrowDown': focusRow(rows[i + 1]); break;
      case 'ArrowUp': focusRow(rows[i - 1]); break;
      case 'Home': focusRow(rows[0]); break;
      case 'End': focusRow(rows.at(-1)); break;
      case 'ArrowRight':
        if (isFolder && !expanded.has(row.node.file.path)) toggle(row.node.file.path, true);
        else focusRow(rows[i + 1]?.parent === row ? rows[i + 1] : undefined);
        break;
      case 'ArrowLeft':
        if (isFolder && expanded.has(row.node.file.path)) toggle(row.node.file.path, false);
        else focusRow(row.parent ?? undefined);
        break;
      case 'Enter': case ' ': activate(row); break;
      case 'F2': if (canWrite) openDialog({ type: 'rename', file: row.node.file }); break;
      case 'Delete': if (canWrite) openDialog({ type: 'delete', file: row.node.file }); break;
      default: return;
    }
    e.preventDefault();
  };

  const submit = async () => {
    if (!dialog) return;
    setBusy(true);
    setError(null);
    try {
      if (dialog.type === 'delete') await onDelete(dialog.file.id);
      else {
        const parsed = filePathSchema.safeParse(value.trim());
        if (!parsed.success) throw new Error('Use letters, numbers, spaces, . _ - and / between folders. No leading or double slashes.');
        if (dialog.type === 'create') {
          await onCreate(parsed.data, dialog.kind);
          const parent = parsed.data.includes('/') ? parsed.data.slice(0, parsed.data.lastIndexOf('/')) : null;
          if (parent) toggle(parent, true);
        } else await onMove(dialog.file.id, parsed.data);
      }
      setDialog(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Files</h2>
        {canWrite && (
          <div className="flex gap-1">
            <Button variant="ghost" className="!px-2" onClick={() => startCreate('file')} aria-label="New file">+ File</Button>
            <Button variant="ghost" className="!px-2" onClick={() => startCreate('folder')} aria-label="New folder">+ Folder</Button>
          </div>
        )}
      </div>
      {canWrite && (
        <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5" role="toolbar" aria-label="File actions">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            aria-label="Choose files to import"
            onChange={(e) => void importFiles(e.target.files)}
          />
          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => fileInput.current?.click()} title="Import existing files from your computer">
            ⬆ Upload
          </Button>
          <Button
            variant="ghost"
            className="!px-2 !py-1 text-xs"
            disabled={!selected}
            onClick={() => selected && openDialog({ type: 'rename', file: selected })}
            title="Rename or move the selected item (F2)"
          >
            Rename
          </Button>
          <Button
            variant="ghost"
            className="!px-2 !py-1 text-xs"
            disabled={!selected}
            onClick={() => selected && openDialog({ type: 'delete', file: selected })}
            title="Delete the selected item (Delete)"
          >
            Delete
          </Button>
        </div>
      )}
      {notice && (
        <div role="status" className={`flex items-start justify-between gap-2 border-b border-border px-3 py-2 text-xs ${notice.ok ? 'text-ok' : 'text-danger'}`}>
          <ul className="space-y-0.5">
            {notice.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message" className="shrink-0 px-1">×</button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-muted">{canWrite ? 'No files yet. Create one to start coding.' : 'This project has no files yet.'}</p>
      ) : (
        <ul role="tree" aria-label="Project files" onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-auto py-1 text-sm">
          {rows.map((row) => {
            const f = row.node.file;
            const isFolder = f.kind === 'folder';
            const open = expanded.has(f.path);
            const item = (
              <li
                key={f.id}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={f.id === activeId}
                aria-expanded={isFolder ? open : undefined}
                tabIndex={row === tabStop ? 0 : -1}
                ref={(el) => {
                  if (el) itemRefs.current.set(f.path, el);
                  else itemRefs.current.delete(f.path);
                }}
                onFocus={() => setFocusPath(f.path)}
                onClick={() => activate(row)}
                style={{ paddingLeft: `${row.depth * 14 + 12}px` }}
                className={`flex cursor-pointer items-center gap-1.5 py-1 pr-2 hover:bg-surface-2 ${f.id === activeId ? 'bg-surface-2 font-semibold' : ''}`}
              >
                <span aria-hidden className="w-4 text-center text-muted">{isFolder ? (open ? '▾' : '▸') : '·'}</span>
                <span className="truncate">{row.node.name}</span>
                <span className="sr-only">{isFolder ? 'folder' : 'file'}</span>
              </li>
            );
            if (!canWrite) return <Fragment key={f.id}>{item}</Fragment>;
            const menuItem = 'cursor-pointer rounded px-2 py-1.5 outline-none data-[highlighted]:bg-surface-2';
            return (
              <ContextMenu.Root key={f.id} onOpenChange={(o) => o && setFocusPath(f.path)}>
                <ContextMenu.Trigger asChild>{item}</ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content className="z-50 min-w-40 rounded-md border border-border bg-surface p-1 text-sm shadow-lg">
                    {!isFolder && (
                      <ContextMenu.Item className={menuItem} onSelect={() => onOpen(f.id)}>
                        Open
                      </ContextMenu.Item>
                    )}
                    <ContextMenu.Item className={menuItem} onSelect={() => openDialog({ type: 'rename', file: f })}>
                      Rename or move…
                    </ContextMenu.Item>
                    <ContextMenu.Item className={`${menuItem} text-danger`} onSelect={() => openDialog({ type: 'delete', file: f })}>
                      Delete…
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            );
          })}
        </ul>
      )}

      <Modal
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={
          dialog?.type === 'create' ? `New ${dialog.kind}` : dialog?.type === 'rename' ? 'Rename or move' : 'Delete'
        }
        description={
          dialog?.type === 'delete'
            ? `Delete “${dialog.file.path}”${dialog.file.kind === 'folder' ? ' and everything inside it' : ''}? Anyone editing it will be disconnected.`
            : dialog?.type === 'rename'
              ? 'Change the path to rename it or move it to another folder.'
              : 'Use / to place it in an existing folder, e.g. src/index.js'
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          {dialog?.type !== 'delete' && (
            <Field label="Path" value={value} onChange={(e) => setValue(e.target.value)} autoFocus required spellCheck={false} />
          )}
          {error != null && <ErrorNote error={error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setDialog(null)}>Cancel</Button>
            <Button type="submit" variant={dialog?.type === 'delete' ? 'danger' : 'primary'} disabled={busy}>
              {dialog?.type === 'delete' ? 'Delete' : dialog?.type === 'rename' ? 'Save' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
