"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { StatusScreen } from "@/components/contact/status-screen";
import { Button, ButtonLink } from "@/components/ui/button";
import { Magnetic } from "@/components/ui/magnetic";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("Error");
  const fx = useTranslations("FX.contact.error");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      code="ERR"
      status={fx("status")}
      detail={error.digest}
      title={t("title")}
      accent={t("titleAccent")}
      body={t("body")}
    >
      <div className="flex flex-wrap gap-3">
        <Magnetic>
          <Button size="lg" onClick={() => retry()}>
            {t("retry")}
          </Button>
        </Magnetic>
        <Magnetic>
          <ButtonLink href="/" size="lg" variant="secondary">
            {t("home")}
          </ButtonLink>
        </Magnetic>
      </div>
    </StatusScreen>
  );
}
