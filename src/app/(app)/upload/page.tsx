import type { Metadata } from "next";
import { getAppContext } from "@/lib/app-context";
import { requirePageRole } from "@/lib/auth/page-session";
import { PageHeader } from "@/components/app/page-header";
import { UploadForm } from "@/components/app/upload-form";

export const metadata: Metadata = { title: "Upload Events file" };
export const dynamic = "force-dynamic";

/** docs/ux-design.md section 5.2. Submitter (employer fixed) and Admin (employer + execution date). */
export default async function UploadPage() {
  const session = await requirePageRole("EmployerSubmitter", "Admin");
  const ctx = await getAppContext();
  const today = ctx.clock().toISOString().slice(0, 10);
  return (
    <div className="space-y-6">
      <PageHeader title="Upload Events file" description="Terminations (TERFIN), retirements (RETFIN) and pre-retirement deaths (DECFIN)." breadcrumbs={[{ label: "Submit" }, { label: "Upload" }]} />
      <UploadForm role={session.role} employerId={session.employerId} maxBytes={ctx.config.maxUploadBytes} maxRows={ctx.config.maxUploadRows} today={today} />
    </div>
  );
}