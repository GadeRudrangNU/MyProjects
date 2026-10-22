import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ProjectNav } from "@/components/project-nav";
import { UploadPanel } from "@/components/upload-panel";
import { UploadProvider } from "@/lib/upload";
import { ApiError } from "@/lib/api/client";
import { guarded, serverApi } from "@/lib/api/server";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await guarded(async () => {
    try {
      return await serverApi.project(projectId);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
      throw err;
    }
  });
  return (
    <UploadProvider>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col md:flex-row">
        <ProjectNav project={project} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      <UploadPanel />
    </UploadProvider>
  );
}
