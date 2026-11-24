import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { StepUpForm } from "@/components/account/step-up-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { STEP_UP_TTL_SECONDS } from "@/lib/auth/constants";
import { requireCurrentUser } from "@/lib/auth/guards";
import { isStepUpFresh, safeStepUpNext } from "@/lib/auth/step-up";

export const metadata: Metadata = {
  title: "Verify your identity",
  robots: { index: false, follow: false },
};

export default async function StepUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const user = await requireCurrentUser("/dashboard/step-up");
  const params = await searchParams;
  const next = safeStepUpNext(
    typeof params.next === "string" ? params.next : undefined,
  );

  if (isStepUpFresh(user.steppedUpAt)) {
    redirect(next);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        title="Verify your identity"
        description="This page changes access and site configuration, so it asks for a fresh identity check."
      />

      <Notice tone="info">
        After verifying, you will return to the page you requested. If a
        sensitive form was interrupted, submit it again.
      </Notice>

      <Card>
        <CardHeader
          title="Confirm it is you"
          description="Sensitive administrator tools stay locked until this check succeeds."
        />
        <CardBody>
          <StepUpForm
            next={next}
            mfaEnabled={user.mfaEnabled}
            ttlMinutes={STEP_UP_TTL_SECONDS / 60}
          />
        </CardBody>
      </Card>
    </div>
  );
}
