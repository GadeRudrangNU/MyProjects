"use client";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/card";

export default function ProjectError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="px-4 py-10 sm:px-6">
      <ErrorState
        title="This page could not load"
        message={error.message || "The API did not answer. Check that it is running and try again."}
        action={<Button variant="outline" onClick={reset}>Try again</Button>}
      />
    </main>
  );
}
