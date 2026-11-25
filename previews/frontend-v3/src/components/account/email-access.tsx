"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  isRegistrationRequestId, readerRegistrationEnabled, registerReader, resendReaderCode,
  requestReaderReset, resetReaderPassword, verifyReaderCode,
} from "@/lib/account-session";
import { Link, useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/components/fx/hooks";
import { validReaderNickname } from "@/shared/site/reader-policy.mjs";
import { accountCopy, accountWorkflowCopy } from "./account-copy";
import { AccountFlowLinks, FormFeedback, formText, useAccountAction } from "./account-form";
import { accountFlowHref, resetTokenFromAddress, type AccountReturn, type Invitation } from "./account-paths";
import styles from "./sign-in.module.css";

type AccessProps = { english: boolean; requested: AccountReturn };
type Registration = { email: string; requestId: string };
const registrationKey = "sansphase-reader-registration";
let memoryRegistration: Registration | null = null;
let resendAfter = 0;

function rememberRegistration(registration: Registration | null) {
  memoryRegistration = registration;
  resendAfter = registration ? Date.now() + 60_000 : 0;
  try {
    if (registration) window.sessionStorage.setItem(registrationKey, JSON.stringify(registration));
    else window.sessionStorage.removeItem(registrationKey);
  } catch { /* The current page can still use the in-memory registration. */ }
}

function registrationInBrowser(): Registration | null {
  if (memoryRegistration) return memoryRegistration;
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(registrationKey) ?? "null");
    if (value && typeof value === "object" && "email" in value && typeof value.email === "string" &&
      "requestId" in value && isRegistrationRequestId(value.requestId)) return { email: value.email, requestId: value.requestId };
  } catch { /* This browser has no readable registration request. */ }
  return null;
}

function useMailAvailability() {
  const [available, setAvailable] = useState<"checking" | "enabled" | "unavailable">("checking");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readerRegistrationEnabled(controller.signal).then((enabled) => {
      if (!controller.signal.aborted) setAvailable(enabled ? "enabled" : "unavailable");
    }, () => {
      if (!controller.signal.aborted) setAvailable("unavailable");
    });
    return () => controller.abort();
  }, [attempt]);
  return {
    available,
    retry() {
      setAvailable("checking");
      setAttempt((previous) => previous + 1);
    },
  };
}

function MailStatus({ mail, english }: { mail: ReturnType<typeof useMailAvailability>; english: boolean }) {
  const copy = english ? accountWorkflowCopy.en : accountWorkflowCopy.zh;
  if (mail.available === "checking") return <p role="status" className={styles.message}>{copy.checking}</p>;
  if (mail.available === "unavailable") return (
    <div className={styles.feedback}>
      <p role="alert" className={styles.error}>{copy.registrationUnavailable}</p>
      <button type="button" className={styles.textAction} onClick={mail.retry}>{(english ? accountCopy.en : accountCopy.zh).retry}</button>
    </div>
  );
  return null;
}

export function RegistrationForm({ english, requested, invitation }: AccessProps & { invitation: Invitation }) {
  const copy = english ? accountWorkflowCopy.en : accountWorkflowCopy.zh;
  const mail = useMailAvailability();
  const action = useAccountAction(english);
  const router = useRouter();
  const invalidInvite = invitation.present && !invitation.code;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mail.available !== "enabled" || invalidInvite) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = formText(values, "email").trim().toLowerCase();
    const nickname = formText(values, "nickname").trim().normalize("NFC");
    if (!validReaderNickname(nickname)) { action.showError(copy.invalidNickname); return; }
    const phone = formText(values, "phone").trim();
    const password = formText(values, "password");
    void action.run(async (signal) => {
      const requestId = await registerReader({ email, nickname, phone, password,
        ...(invitation.code ? { inviteCode: invitation.code } : {}) }, signal);
      if (signal.aborted) return;
      rememberRegistration({ email, requestId });
      form.reset();
      router.replace(accountFlowHref("verify", requested));
    });
  }

  return (
    <>
      <form className={styles.form} method="post" onSubmit={submit} onInput={action.clearFeedback}>
        {invitation.present && (
          <p className={invalidInvite ? styles.error : styles.message}>
            {invalidInvite ? copy.invalidInvitation : copy.invitation}{" "}
            <Link className={styles.textAction} prefetch={false} href={accountFlowHref("register", requested)}>{copy.clearInvitation}</Link>
          </p>
        )}
        <label className={styles.field}>
          <span>{copy.nickname}</span>
          <input className={styles.input} name="nickname" autoComplete="nickname" maxLength={128} required readOnly={action.pending} />
        </label>
        <EmailField english={english} readOnly={action.pending} />
        <label className={styles.field}>
          <span>{copy.phone}</span>
          <input className={styles.input} type="tel" name="phone" autoComplete="tel" inputMode="numeric" pattern="1[3-9][0-9]{9}" maxLength={11} required readOnly={action.pending} />
        </label>
        <NewPasswordField copy={copy} readOnly={action.pending} />
        <MailStatus mail={mail} english={english} />
        <FormFeedback feedback={action.feedback} />
        <button className={styles.submit} type="submit" disabled={action.pending || mail.available !== "enabled" || invalidInvite} aria-busy={action.pending}>
          {action.pending ? copy.working : copy.getCode}
        </button>
        <p className={styles.message}>{copy.retention}</p>
      </form>
      <AccountFlowLinks english={english} requested={requested} current="register" />
    </>
  );
}

export function VerifyEmailForm({ english, requested }: AccessProps) {
  const copy = english ? accountWorkflowCopy.en : accountWorkflowCopy.zh;
  const action = useAccountAction(english);
  const ready = useHydrated();
  const emailField = useRef<HTMLInputElement>(null);
  const codeField = useRef<HTMLInputElement>(null);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    const saved = registrationInBrowser();
    if (saved && emailField.current) {
      emailField.current.value = saved.email;
      codeField.current?.focus({ preventScroll: true });
    }
  }, []);

  function checkRegistration() {
    const registration = registrationInBrowser();
    if (registration?.email !== emailField.current?.value.trim().toLowerCase()) {
      action.showError(copy.noChallenge);
      return null;
    }
    return registration;
  }
  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const registration = checkRegistration();
    if (!registration) return;
    const form = event.currentTarget;
    const code = formText(new FormData(form), "code");
    void action.run(async (signal) => {
      await verifyReaderCode(registration.email, registration.requestId, code, signal);
      if (signal.aborted) return;
      form.reset();
      rememberRegistration(null);
      setVerified(true);
      return copy.verified;
    }, copy.invalidCode);
  }
  function resend() {
    const registration = checkRegistration();
    if (!registration) return;
    if (Date.now() < resendAfter) { action.showError(copy.resendWait); return; }
    void action.run(async (signal) => {
      const requestId = await resendReaderCode(registration.email, registration.requestId, signal);
      if (signal.aborted) return;
      rememberRegistration({ ...registration, requestId });
      if (codeField.current) codeField.current.value = "";
      return copy.resent;
    });
  }

  return (
    <>
      {!verified && (
        <form className={styles.form} method="post" onSubmit={verify} onInput={action.clearFeedback}>
          <EmailField english={english} inputRef={emailField} readOnly={action.pending} />
          <label className={styles.field}>
            <span>{copy.verificationCode}</span>
            <input ref={codeField} className={styles.input} name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required readOnly={action.pending} />
          </label>
          <button className={styles.submit} type="submit" disabled={!ready || action.pending} aria-busy={action.pending}>
            {action.pending ? copy.working : copy.verifyAction}
          </button>
          <button type="button" className={styles.textAction} disabled={!ready || action.pending} onClick={resend}>{copy.resendCode}</button>
        </form>
      )}
      <FormFeedback feedback={action.feedback} />
      <AccountFlowLinks english={english} requested={requested} current="verify" />
    </>
  );
}

export function RecoveryForm({ english, requested }: AccessProps) {
  const copy = english ? accountWorkflowCopy.en : accountWorkflowCopy.zh;
  const mail = useMailAvailability();
  const action = useAccountAction(english);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mail.available !== "enabled") return;
    const email = formText(new FormData(event.currentTarget), "email").trim().toLowerCase();
    void action.run(async (signal) => {
      await requestReaderReset(email, signal);
      return copy.resetSent;
    });
  }

  return (
    <>
      <form className={styles.form} method="post" onSubmit={submit} onInput={action.clearFeedback}>
        <EmailField english={english} readOnly={action.pending} />
        <MailStatus mail={mail} english={english} />
        <FormFeedback feedback={action.feedback} />
        <button className={styles.submit} type="submit" disabled={action.pending || mail.available !== "enabled"} aria-busy={action.pending}>
          {action.pending ? copy.working : copy.sendReset}
        </button>
      </form>
      <AccountFlowLinks english={english} requested={requested} current="forgot" />
    </>
  );
}

export function ResetPasswordForm({ english, requested }: AccessProps) {
  const copy = english ? accountWorkflowCopy.en : accountWorkflowCopy.zh;
  const action = useAccountAction(english);
  const ready = useHydrated();
  const [saved, setSaved] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = resetTokenFromAddress(new URL(window.location.href));
    if (!token) { action.showError(copy.invalidReset); return; }
    const form = event.currentTarget;
    const password = formText(new FormData(form), "password");
    void action.run(async (signal) => {
      await resetReaderPassword(token, password, signal);
      if (signal.aborted) return;
      window.history.replaceState(window.history.state, "", english ? "/en/reset" : "/reset");
      form.reset();
      setSaved(true);
      return copy.resetDone;
    }, copy.invalidReset);
  }

  return (
    <>
      {!saved && (
        <form className={styles.form} method="post" onSubmit={submit} onInput={action.clearFeedback}>
          <NewPasswordField copy={copy} readOnly={action.pending} />
          <button className={styles.submit} type="submit" disabled={!ready || action.pending} aria-busy={action.pending}>
            {action.pending ? copy.working : copy.resetAction}
          </button>
        </form>
      )}
      <FormFeedback feedback={action.feedback} />
      <AccountFlowLinks english={english} requested={requested} current="reset" />
    </>
  );
}

function EmailField({ english, readOnly, inputRef }: { english: boolean; readOnly: boolean; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <label className={styles.field}>
      <span>{(english ? accountCopy.en : accountCopy.zh).email}</span>
      <input ref={inputRef} className={styles.input} type="email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required readOnly={readOnly} />
    </label>
  );
}

function NewPasswordField({ copy, readOnly }: { copy: typeof accountWorkflowCopy.zh | typeof accountWorkflowCopy.en; readOnly: boolean }) {
  return (
    <label className={styles.field}>
      <span>{copy.newPassword}</span>
      <input className={styles.input} type="password" name="password" autoComplete="new-password" minLength={8} maxLength={128} required readOnly={readOnly} />
    </label>
  );
}
