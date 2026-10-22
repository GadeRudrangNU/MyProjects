"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Eye,
  File as FileIcon,
  FileText,
  Film,
  ImageIcon,
  Music,
  Search,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileKindOf, formatBytes, listObjectsQuery, type Bucket, type FileKind, type StoredObject } from "@bytedrop/shared";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api/client";
import { useUploadManager, useUploads } from "@/lib/upload";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import { BucketDialog } from "./bucket-dialog";
import { DeleteDialog } from "./delete-dialog";
import { PreviewDialog } from "./preview-dialog";
import { applyClick, applyKey, emptySelection, type SelectionState } from "./selection";
import { ShareDialog } from "./share-dialog";
import { useUrlState } from "./use-url-state";

interface Page {
  items: StoredObject[];
  nextCursor: string | null;
}
interface Filters {
  q?: string;
  sort: "name" | "size" | "created";
  dir: "asc" | "desc";
  kind?: FileKind;
}

const ROW = 44;
const kindIcon = { image: ImageIcon, video: Film, audio: Music, pdf: FileText, text: FileText, other: FileIcon } as const;

export function FileBrowser({
  projectId,
  buckets,
  bucket,
  filters,
  initialPage,
}: {
  projectId: string;
  buckets: Bucket[];
  bucket: string | null;
  filters: Filters;
  initialPage: Page;
}) {
  const sp = useSearchParams();
  const url = useUrlState("client");
  const manager = useUploadManager();
  const uploads = useUploads();

  const [bucketList, setBucketList] = useState(buckets);
  const requested = sp.get("bucket");
  const activeBucket = bucketList.find((b) => b.name === requested)?.name ?? bucket ?? bucketList[0]?.name ?? null;
  const parsed = listObjectsQuery.pick({ q: true, sort: true, dir: true, kind: true }).safeParse({
    q: sp.get("q") || undefined,
    sort: sp.get("sort") || undefined,
    dir: sp.get("dir") || undefined,
    kind: sp.get("kind") || undefined,
  });
  const live: Filters = parsed.success
    ? { q: parsed.data.q, sort: parsed.data.sort, dir: parsed.data.dir, kind: parsed.data.kind }
    : { sort: "name", dir: "asc" };
  const filterKey = JSON.stringify([activeBucket, live.q, live.sort, live.dir, live.kind]);
  const seedKey = JSON.stringify([bucket, filters.q, filters.sort, filters.dir, filters.kind]);

  const [items, setItems] = useState<StoredObject[]>(initialPage.items);
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sel, setSel] = useState<SelectionState>(emptySelection);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<StoredObject | null>(null);
  const [sharing, setSharing] = useState<StoredObject | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [search, setSearch] = useState(live.q ?? "");
  const [version, setVersion] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const seeded = useRef(true);

  const reload = useCallback(() => {
    setVersion((v) => v + 1);
    void api.buckets(projectId).then(setBucketList).catch(() => {});
  }, [projectId]);

  // The server renders the first page; after that this component owns its data and refetches page one on any change.
  useEffect(() => {
    const first = seeded.current;
    seeded.current = false;
    if (first && filterKey === seedKey && version === 0) return;
    if (!activeBucket) return;
    let current = true;
    setLoading(true);
    api
      .objects(projectId, activeBucket, { q: live.q, sort: live.sort, dir: live.dir, kind: live.kind, limit: 200 })
      .then((page) => {
        if (!current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setSel(emptySelection);
        setLoadError(null);
      })
      .catch((err) => current && setLoadError(err instanceof Error ? err.message : "Could not load files"))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, version]);

  const keys = useMemo(() => items.map((i) => i.key), [items]);
  const bucketInfo = bucketList.find((b) => b.name === activeBucket);

  const loadMore = useCallback(async () => {
    if (!activeBucket || !cursor || loading) return;
    setLoading(true);
    try {
      const next = await api.objects(projectId, activeBucket, { ...live, limit: 200, cursor });
      setItems((cur) => [...cur, ...next.items]);
      setCursor(next.nextCursor);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load more files");
    } finally {
      setLoading(false);
    }
  }, [activeBucket, cursor, filterKey, loading, projectId]);

  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 12,
  });
  const vItems = virtual.getVirtualItems();

  useEffect(() => {
    const last = vItems[vItems.length - 1];
    if (last && last.index >= items.length - 25) void loadMore();
  }, [vItems, items.length, loadMore]);

  // Debounce search into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      const current = new URLSearchParams(window.location.search).get("q") ?? "";
      if (current !== search) url.set({ q: search || undefined });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Refresh the listing whenever an upload into this bucket finishes.
  const doneCount = uploads.filter((u) => u.status === "done" && u.bucket === activeBucket).length;
  const lastDone = useRef(doneCount);
  useEffect(() => {
    if (doneCount > lastDone.current) reload();
    lastDone.current = doneCount;
  }, [doneCount, reload]);

  // "/" jumps to search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedKeys = [...sel.selected];
  const single = selectedKeys.length === 1 ? items.find((i) => i.key === selectedKeys[0]) : undefined;
  const activeItem = items[sel.active];

  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = applyKey(sel, e, keys, Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW)));
    if (!r.handled) return;
    e.preventDefault();
    setSel(r.state);
    if (r.state.active !== sel.active || /^(Home|End|Page(Up|Down))$/.test(e.key)) virtual.scrollToIndex(r.state.active, { align: "auto" });
    if (r.action === "open" && activeItem) setPreview(activeItem);
    if (r.action === "delete") setDeleting([...r.state.selected]);
  };

  const addFiles = (files: FileList | File[]) => {
    if (!activeBucket || files.length === 0) return;
    manager.add([...files], { projectId, bucket: activeBucket });
  };

  const bucketName = activeBucket;
  if (bucketList.length === 0 || !bucketName) {
    return (
      <EmptyState icon={<Upload />} title="Create your first bucket" action={<BucketDialog projectId={projectId} onCreated={(b) => {
            reload();
            url.set({ bucket: b.name });
          }} />}>
        Buckets group files and decide whether they are public or need a signed link.
      </EmptyState>
    );
  }

  const hasFilters = Boolean(live.q || live.kind);

  return (
    <div
      className="relative space-y-3"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-end gap-2" role="toolbar" aria-label="File actions">
        <div className="w-44">
          <label htmlFor="bucket" className="mb-1 block text-xs font-medium text-muted-foreground">
            Bucket
          </label>
          <Select id="bucket" value={bucketName} onChange={(e) => {
              setSearch("");
              url.set({ bucket: e.target.value, q: undefined });
            }}>
            {bucketList.map((b) => (
              <option key={b.id} value={b.name}>
                {b.name} {b.isPublic ? "" : "(private)"}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-48 flex-1">
          <label htmlFor="file-search" className="mb-1 block text-xs font-medium text-muted-foreground">
            Search <span className="text-muted-foreground/80">(press / to focus)</span>
          </label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              id="file-search"
              ref={searchRef}
              className="pl-8"
              type="search"
              placeholder="Filter by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="w-32">
          <label htmlFor="kind" className="mb-1 block text-xs font-medium text-muted-foreground">
            Type
          </label>
          <Select id="kind" value={live.kind ?? ""} onChange={(e) => url.set({ kind: e.target.value || undefined })}>
            <option value="">All types</option>
            <option value="image">Images</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="pdf">PDF</option>
            <option value="text">Text</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div className="flex items-end gap-1">
          <div className="w-32">
            <label htmlFor="sort" className="mb-1 block text-xs font-medium text-muted-foreground">
              Sort by
            </label>
            <Select id="sort" value={live.sort} onChange={(e) => url.set({ sort: e.target.value === "name" ? undefined : e.target.value })}>
              <option value="name">Name</option>
              <option value="size">Size</option>
              <option value="created">Uploaded</option>
            </Select>
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label={live.dir === "asc" ? "Sort ascending, switch to descending" : "Sort descending, switch to ascending"}
            onClick={() => url.set({ dir: live.dir === "asc" ? "desc" : undefined })}
          >
            {live.dir === "asc" ? <ArrowDownAZ /> : <ArrowUpAZ />}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          aria-label="Choose files to upload"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button onClick={() => fileInput.current?.click()}>
          <Upload /> Upload files
        </Button>
        <BucketDialog projectId={projectId} onCreated={(b) => {
          reload();
          setSearch("");
          url.set({ bucket: b.name, q: undefined });
        }} />
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <Button variant="outline" disabled={!single} onClick={() => single && setPreview(single)}>
          <Eye /> Preview
        </Button>
        <Button variant="outline" disabled={!single} onClick={() => single && setSharing(single)}>
          <Share2 /> Share
        </Button>
        <Button variant="outline" disabled={selectedKeys.length === 0} onClick={() => setDeleting(selectedKeys)}>
          <Trash2 /> Delete{selectedKeys.length > 0 ? ` (${selectedKeys.length})` : ""}
        </Button>
        <p role="status" aria-live="polite" className="ml-auto text-xs text-muted-foreground">
          {selectedKeys.length > 0 ? `${selectedKeys.length} selected` : `${formatNumber(bucketInfo?.objectCount ?? items.length)} files`}
          {bucketInfo ? ` · ${formatBytes(bucketInfo.totalBytes)}` : ""}
        </p>
      </div>

      {items.length === 0 ? (
        hasFilters ? (
          <EmptyState icon={<Search />} title="No files match" action={<Button variant="outline" onClick={() => { setSearch(""); url.set({ q: undefined, kind: undefined }); }}>Clear filters</Button>}>
            Try a different name or file type.
          </EmptyState>
        ) : (
          <EmptyState icon={<Upload />} title="This bucket is empty" action={<Button onClick={() => fileInput.current?.click()}>Upload files</Button>}>
            Drag files anywhere on this page, or use the upload button.
          </EmptyState>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div
            aria-hidden
            className="grid grid-cols-[1fr_5.5rem] gap-3 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[1fr_6rem_7rem_9rem]"
          >
            <span>Name</span>
            <span className="text-right">Size</span>
            <span className="hidden sm:block">Type</span>
            <span className="hidden sm:block">Uploaded (UTC)</span>
          </div>
          <div
            ref={scrollRef}
            role="listbox"
            tabIndex={0}
            aria-label={`Files in ${bucketName}`}
            aria-multiselectable="true"
            aria-activedescendant={activeItem ? `file-row-${sel.active}` : undefined}
            onKeyDown={onKeyDown}
            className="h-[min(60dvh,34rem)] overflow-y-auto focus-visible:outline-offset-[-2px]"
            data-testid="file-list"
          >
            <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
              {vItems.map((v) => {
                const item = items[v.index]!;
                const Icon = kindIcon[fileKindOf(item.contentType)];
                const selected = sel.selected.has(item.key);
                return (
                  <div
                    key={item.key}
                    id={`file-row-${v.index}`}
                    role="option"
                    aria-selected={selected}
                    aria-posinset={v.index + 1}
                    aria-setsize={items.length}
                    data-testid="file-row"
                    onClick={(e) => {
                      setSel((s) => applyClick(s, v.index, e, keys));
                      scrollRef.current?.focus({ preventScroll: true });
                    }}
                    onDoubleClick={() => setPreview(item)}
                    className={cn(
                      "absolute inset-x-0 grid cursor-default grid-cols-[1fr_5.5rem] items-center gap-3 border-b px-4 text-sm sm:grid-cols-[1fr_6rem_7rem_9rem]",
                      selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
                      v.index === sel.active && "outline-2 -outline-offset-2 outline-ring [:focus-within_&]:outline",
                    )}
                    style={{ height: v.size, transform: `translateY(${v.start}px)` }}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate" title={item.key}>
                        {item.key}
                      </span>
                    </span>
                    <span className="text-right tabular-nums">{formatBytes(item.size)}</span>
                    <span className="hidden truncate text-muted-foreground sm:block">
                      <Badge>{item.kind}</Badge>
                    </span>
                    <span className="hidden text-muted-foreground sm:block">{formatDateTime(item.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
            <span>
              Loaded {formatNumber(items.length)}
              {cursor ? " · more load as you scroll" : " · end of list"}
            </span>
            <span aria-live="polite">{loading ? "Loading…" : loadError ? <button className="text-danger underline" onClick={() => void loadMore()}>{loadError}. Retry</button> : null}</span>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Keyboard: arrows move, Shift extends, Space toggles, Ctrl+A selects all, Enter previews, Delete removes.
      </p>

      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/85">
          <p className="text-sm font-medium">Drop files to upload to {bucketName}</p>
        </div>
      ) : null}

      <PreviewDialog projectId={projectId} bucket={bucketName} item={preview} onClose={() => setPreview(null)} />
      <ShareDialog
        projectId={projectId}
        bucket={bucketName}
        isPublic={bucketInfo?.isPublic ?? false}
        item={sharing}
        onClose={() => setSharing(null)}
      />
      <DeleteDialog
        projectId={projectId}
        bucket={bucketName}
        keys={deleting}
        onClose={() => setDeleting(null)}
        onDone={() => {
          setDeleting(null);
          setSel(emptySelection);
          reload();
        }}
      />
    </div>
  );
}
