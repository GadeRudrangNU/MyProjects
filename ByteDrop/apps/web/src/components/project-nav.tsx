"use client";

import { BarChart3, FolderOpen, Image as ImageIcon, KeyRound, Menu, Webhook } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { formatBytes, type Project } from "@bytedrop/shared";
import { cn } from "@/lib/utils";

const items = [
  { slug: "files", label: "Files", icon: FolderOpen },
  { slug: "analytics", label: "Analytics", icon: BarChart3 },
  { slug: "playground", label: "Transforms", icon: ImageIcon },
  { slug: "webhooks", label: "Webhooks", icon: Webhook },
  { slug: "keys", label: "API keys", icon: KeyRound },
];

export function ProjectNav({ project }: { project: Project }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const pct = Math.min(100, (project.usedBytes / project.quotaBytes) * 100);

  return (
    <aside className="border-b md:sticky md:top-0 md:h-[calc(100dvh-3.5rem)] md:w-56 md:shrink-0 md:self-start md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-4 py-3 md:block md:py-5">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Project</p>
          <p className="truncate font-semibold" title={project.name}>
            {project.name}
          </p>
        </div>
        <button
          type="button"
          className="rounded-md p-2 hover:bg-muted md:hidden"
          aria-expanded={open}
          aria-controls="project-nav"
          aria-label="Toggle navigation"
          onClick={() => setOpen((o) => !o)}
        >
          <Menu className="size-5" />
        </button>
      </div>
      <nav id="project-nav" aria-label="Project" className={cn("px-2 pb-3 md:block md:pb-0", open ? "block" : "hidden")}>
        <ul className="flex flex-col gap-0.5">
          {items.map(({ slug, label, icon: Icon }) => {
            const href = `/p/${project.id}/${slug}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={slug}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
                    active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 rounded-lg bg-muted/60 p-3 text-xs md:mx-1">
          <p className="font-medium">Storage</p>
          <div
            role="progressbar"
            aria-label="Storage used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
          >
            <div className="h-full bg-primary" style={{ width: `${Math.max(pct, 1)}%` }} />
          </div>
          <p className="mt-1.5 text-muted-foreground">
            {formatBytes(project.usedBytes)} / {formatBytes(project.quotaBytes)}
          </p>
        </div>
      </nav>
    </aside>
  );
}
