"use client";

import { useEffect, useRef, useState } from "react";
import { AccountRequestError } from "@/lib/account-session";
import { Link } from "@/i18n/navigation";
import { accountCopy, accountWorkflowCopy } from "./account-copy";
import { accountFlowHref, type AccountReturn } from "./account-paths";
import styles from "./sign-in.module.css";

type Feedback = { message: string; error?: boolean };

export function useAccountAction(english: boolean) {
  const copy = english ? accountCopy.en : accountCopy.zh;
  const active = useRef<AbortController>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function run(action: (signal: AbortSignal) => Promise<string | void>, invalid: string = copy.invalidDetails) {
    if (active.current) return;
    const request = new AbortController();
    active.current = request;
    setPending(true);
    setFeedback(null);
    try {
      const message = await action(request.signal);
      if (message && !request.signal.aborted) setFeedback({ message });
    } catch (error) {
      if (!request.signal.aborted) {
        let message: string = copy.unavailable;
        if (error instanceof AccountRequestError) {
          message = error.code === "invalidDetails" ? (!english && error.detail || invalid) : copy[error.code];
        }
        setFeedback({ message, error: true });
      }
    } finally {
      active.current = null;
      if (!request.signal.aborted) setPending(false);
    }
  }

  return {
    pending,
    feedback,
    run,
    showError: (message: string) => setFeedback({ message, error: true }),
    clearFeedback: () => setFeedback(null),
  };
}

export function FormFeedback({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  return <p className={feedback.error ? styles.error : styles.message} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>;
}

export function AccountFlowLinks({ english, requested, current, invite }: {
  english: boolean;
  requested: AccountReturn;
  current: "sign-in" | "register" | "forgot" | "verify" | "reset";
  invite?: string | null;
}) {
  const copy = english ? accountWorkflowCopy.en : accountWorkflowCopy.zh;
  return (
    <div className={styles.flowLinks}>
      {current !== "sign-in" && <Link prefetch={false} href={accountFlowHref("sign-in", requested)}>{copy.signIn}</Link>}
      {current !== "register" && current !== "reset" && <Link prefetch={false} href={accountFlowHref("register", requested, invite)}>{copy.register}</Link>}
      {current !== "forgot" && <Link prefetch={false} href={accountFlowHref("forgot", requested)}>{copy.forgot}</Link>}
      {(current === "sign-in" || current === "register") && <Link prefetch={false} href={accountFlowHref("verify", requested)}>{copy.haveCode}</Link>}
    </div>
  );
}

export function formText(form: FormData, field: string) {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
}
