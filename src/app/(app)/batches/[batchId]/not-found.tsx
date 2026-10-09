import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

export default function BatchNotFound() {
  return (
    <EmptyState
      illustration="search"
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