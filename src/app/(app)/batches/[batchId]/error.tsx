"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/app/alert";

export default function BatchError({ error, reset }: { error: Error & { digest?: string }; reset(): void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") console.error(error);
  }, [error]);
  return (
    <Alert
      variant="error"
      title="Something went wrong loading this section"
      actions={
        <Button size="sm" variant="outline" onClick={reset}>
          <RefreshCw aria-hidden="true" /> Retry
        </Button>
      }
    >
      <p className="font-mono text-caption">{error.digest ?? "n/a"}</p>
    </Alert>
  );
}