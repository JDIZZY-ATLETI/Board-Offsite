"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/app/alert";

/** docs/ux-design.md section 5.11 / 9.3. `digest` doubles as the correlation id for support. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset(): void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl py-10">
      <Alert
        variant="error"
        title="Something went wrong loading this section"
        actions={
          <Button size="sm" variant="outline" onClick={reset}>
            <RefreshCw aria-hidden="true" /> Retry
          </Button>
        }
      >
        <p>Try again. If it keeps happening, quote this correlation id to support:</p>
        <p className="mt-1 font-mono text-caption">{error.digest ?? "n/a"}</p>
      </Alert>
    </div>
  );
}