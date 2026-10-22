import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">That page does not exist, or you do not have access to it.</p>
      <Link href="/projects" className="text-sm font-medium text-primary underline">
        Back to projects
      </Link>
    </main>
  );
}
