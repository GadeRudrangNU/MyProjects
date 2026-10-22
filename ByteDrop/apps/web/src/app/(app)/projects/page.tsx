import { FolderOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CreateProject } from "@/components/create-project";
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { guarded, serverApi } from "@/lib/api/server";
import { formatBytes } from "@bytedrop/shared";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const projects = await guarded(() => serverApi.projects());
  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Each project has its own buckets, keys, webhooks and quota.</p>
        </div>
        <CreateProject />
      </div>
      {projects.length === 0 ? (
        <EmptyState icon={<FolderOpen />} title="No projects yet">
          Create a project to start uploading files.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const pct = Math.min(100, (p.usedBytes / p.quotaBytes) * 100);
            return (
              <li key={p.id}>
                <Link href={`/p/${p.id}/files`} className="block rounded-xl">
                  <Card className="transition-colors hover:border-primary">
                    <CardHeader>
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      <p className="text-xs text-muted-foreground">Created {formatDate(p.createdAt)}</p>
                    </CardHeader>
                    <CardContent>
                      <div
                        role="progressbar"
                        aria-label={`Storage used by ${p.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(pct)}
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                      >
                        <div className="h-full bg-primary" style={{ width: `${Math.max(pct, 1)}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {formatBytes(p.usedBytes)} of {formatBytes(p.quotaBytes)} used
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
