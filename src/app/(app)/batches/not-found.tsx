import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

/**
 * Catches `notFound()` thrown by the `[batchId]` layout (a segment cannot catch its own layout). The list page
 * and its `loading.tsx` live in the `(list)` route group so no Suspense boundary wraps that layout and the
 * response is a real HTTP 404 (QA BUG-UI-2).
 */
export default function BatchesNotFound() {
  return (
    <EmptyState
      illustration="search"
      headingLevel="h1"
      title="We couldn't find that batch"
      description="It may belong to another employer, or the id in the link is incomplete."
      action={
        <Button asChild>
          <Link href="/batches">Go to Batches</Link>
        </Button>
      }
    />
  );
}
