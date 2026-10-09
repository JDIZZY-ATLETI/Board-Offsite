"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DevPersona } from "@/lib/auth/dev-session";
import { ROLE_LABELS } from "@/lib/ui/nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLES, type Role } from "@/types";

export interface LoginFormProps {
  personas: readonly DevPersona[];
  current: { userId: string; role: Role; employerId: string | null } | null;
}

export function LoginForm({ personas, current }: LoginFormProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [role, setRole] = React.useState<Role>("EmployerSubmitter");
  const [userId, setUserId] = React.useState("");
  const [employerId, setEmployerId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const signIn = async (p: { userId: string; role: Role; employerId: string | null }, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/auth/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      toast.success(`Signed in as ${p.userId} (${ROLE_LABELS[p.role]})`);
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Pick a persona</CardTitle>
          <CardDescription>Seeded roles for local development.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {personas.map((p) => {
            const active = current?.userId === p.userId && current?.role === p.role;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => signIn({ userId: p.userId, role: p.role, employerId: p.employerId }, p.id)}
                disabled={busy !== null}
                data-testid={`persona-${p.id}`}
                className={cn("flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:border-brand/60 hover:bg-brand-soft/40", active ? "border-brand bg-brand-soft" : "border-border")}
              >
                <span>
                  <span className="block text-body font-medium text-ink">{p.displayName}</span>
                  <span className="block text-small text-ink-muted">{p.description}</span>
                </span>
                {busy === p.id ? <LoaderCircle aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" /> : active ? <span className="text-caption text-brand">current</span> : <span className="font-mono text-caption text-ink-faint">{p.userId}</span>}
              </button>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Custom session</CardTitle>
          <CardDescription>Any user id; Submitters need an employer id.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              signIn({ userId: userId.trim(), role, employerId: role === "EmployerSubmitter" ? employerId.trim() || null : null }, "custom");
            }}
          >
            <div className="space-y-1.5">
              <Label>Role</Label>
              <div role="radiogroup" aria-label="Role" className="flex rounded-sm border border-border p-0.5">
                {ROLES.map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => setRole(r)} className={cn("flex-1 rounded-sm px-2 py-1 text-small", role === r ? "bg-brand-soft font-medium text-brand" : "text-ink-muted hover:text-ink")}>
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-id">User id (required)</Label>
              <Input id="user-id" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="jsmith" pattern="[A-Za-z0-9._@-]{1,128}" required className="font-mono" />
            </div>
            {role === "EmployerSubmitter" ? (
              <div className="space-y-1.5">
                <Label htmlFor="employer-id">Employer id (required)</Label>
                <Input id="employer-id" value={employerId} onChange={(e) => setEmployerId(e.target.value)} placeholder="0235" pattern="[A-Za-z0-9_-]{1,32}" required className="font-mono" />
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-small text-sev-cme-text">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy !== null || !userId.trim() || (role === "EmployerSubmitter" && !employerId.trim())} className="w-full">
              {busy === "custom" ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : null}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}