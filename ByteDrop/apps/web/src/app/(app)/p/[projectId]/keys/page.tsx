import type { Metadata } from "next";
import { KeysPanel } from "@/components/keys/keys-panel";
import { guarded, serverApi } from "@/lib/api/server";

export const metadata: Metadata = { title: "API keys" };

export default async function KeysPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const keys = await guarded(() => serverApi.keys(projectId));
  return (
    <main id="main" className="space-y-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-sm text-muted-foreground">
          Keys authenticate server-side calls with <code className="rounded bg-muted px-1">Authorization: Bearer</code>. Only a hash is stored, and each secret is shown once.
        </p>
      </div>
      <KeysPanel projectId={projectId} keys={keys} />
    </main>
  );
}
