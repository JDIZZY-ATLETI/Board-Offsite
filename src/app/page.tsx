export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Board Offsite
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Your Next.js app scaffold is ready. Start building in{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm">
            src/app
          </code>
          .
        </p>
      </div>
      <a
        className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-gray-700"
        href="/api/health"
      >
        Check API health
      </a>
    </main>
  );
}
