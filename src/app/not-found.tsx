import Link from "next/link";

export default function RootNotFound() {
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-h1">We couldn&apos;t find that page</h1>
      <p className="text-body text-ink-muted">The link may be out of date.</p>
      <Link href="/" className="rounded-md bg-brand px-4 py-2 text-body font-medium text-white hover:bg-brand-hover">
        Go to Dashboard
      </Link>
    </main>
  );
}