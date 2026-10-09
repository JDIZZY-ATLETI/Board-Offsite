import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

export default function AppNotFound() {
  return (
    <EmptyState
      illustration="search"
      title="We couldn't find that page"
      description="The link may be out of date, or the item may have been removed."
      action={
        <Button asChild>
          <Link href="/">Go to Dashboard</Link>
        </Button>
      }
    />
  );
}