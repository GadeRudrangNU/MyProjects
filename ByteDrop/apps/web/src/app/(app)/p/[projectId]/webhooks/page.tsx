import type { Metadata } from "next";
import { deliveryStatusSchema } from "@bytedrop/shared";
import { WebhooksPanel } from "@/components/webhooks/webhooks-panel";
import { guarded, serverApi } from "@/lib/api/server";

export const metadata: Metadata = { title: "Webhooks" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function WebhooksPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status = deliveryStatusSchema.safeParse(raw);
  const [endpoints, deliveries] = await Promise.all([
    guarded(() => serverApi.webhooks(projectId)),
    guarded(() => serverApi.deliveries(projectId, { limit: 25, status: status.success ? status.data : undefined })),
  ]);
  return (
    <main id="main" className="space-y-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="text-sm text-muted-foreground">
          Events are signed with HMAC-SHA256 and retried with exponential backoff. Replay any failed delivery from the log.
        </p>
      </div>
      <WebhooksPanel
        projectId={projectId}
        endpoints={endpoints}
        initialDeliveries={deliveries}
        status={status.success ? status.data : undefined}
      />
    </main>
  );
}
