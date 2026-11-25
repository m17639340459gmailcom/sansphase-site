"use client";

import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AccountRequestError, readAccount, signIn, signOut } from "@/lib/account-session";
import { mountLoginVerificationControl, type LoginVerificationControl } from "@/shared/site/login-verification-control";
import "@/shared/site/login-verification.css";
import type { AccountCopy } from "./account-copy";
import { AccountFlowLinks } from "./account-form";
import { signInDestination, type AccountReturn } from "./account-paths";
import { mountLoginVerificationPopover } from "./login-verification-popover";
import { ProfileSettings } from "./profile-settings";
import styles from "./sign-in.module.css";

type Identity = NonNullable<Awaited<ReturnType<typeof readAccount>>>;
type Session = { status: "checking" | "unavailable" } | { status: "ready"; identity: Identity | null };
const managementEntry = "/admin-console";

function completeReturn(role: Identity["role"], requested: AccountReturn) {
  const destination = signInDestination(role, requested);
  if (destination) {
    window.location.replace(destination);
    return true;
  }
  if (role === "reader" && requested.admin) {
    const reentry = new URL(window.location.href);
    reentry.searchParams.delete("adminReturn");
    window.history.replaceState(window.history.state, "", reentry.pathname + reentry.search + reentry.hash);
  }
  return false;
}

export function SignIn({ copy, english, requested }: { copy: AccountCopy; english: boolean; requested: AccountReturn }) {
  const { page, admin } = requested;
  const formRef = useRef<HTMLFormElement>(null);
  const verification = useRef<LoginVerificationControl>(null);
  const activeRequest = useRef<AbortController>(null);
  const success = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<Session>({ status: "checking" });
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const identity = session.status === "ready" ? session.identity : null;
  const canVerify = session.status === "ready" && !identity;

  useEffect(() => {
    const request = new AbortController();
    void readAccount(request.signal).then((account) => {
      if (request.signal.aborted || (account && completeReturn(account.role, { page, admin }))) return;
      setSession({ status: "ready", identity: account });
    }, () => {
      if (!request.signal.aborted) setSession({ status: "unavailable" });
    });
    return () => request.abort();
  }, [admin, page, sessionAttempt]);

  useEffect(() => {
    if (!canVerify || !formRef.current) return;
    const controller = mountLoginVerificationControl(formRef.current, "reader", {
      english: () => english,
      onError: () => setMessage(copy.verificationFailed),
      mountPanel: mountLoginVerificationPopover,
    });
    verification.current = controller;
    return () => {
      verification.current = null;
      controller.dispose();
    };
  }, [canVerify, copy.verificationFailed, english]);

  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => { if (identity) success.current?.focus({ preventScroll: true }); }, [identity]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const controller = verification.current;
    if (!controller || activeRequest.current || !form.reportValidity()) return;

    let proof: string | null;
    try {
      proof = controller.consume();
    } catch {
      setMessage(copy.verification);
      return;
    }

    const request = new AbortController();
    const fields = new FormData(form);
    activeRequest.current = request;
    setMessage("");
    setPending(true);
    try {
      const account = await signIn(String(fields.get("email") ?? "").trim(), String(fields.get("password") ?? ""), proof, request.signal);
      if (request.signal.aborted) return;
      form.reset();
      if (completeReturn(account.role, requested)) return;
      setShowPassword(false);
      setSession({ status: "ready", identity: account });
    } catch (error) {
      if (!request.signal.aborted) setMessage(error instanceof AccountRequestError ? copy[error.code] : copy.unavailable);
    } finally {
      activeRequest.current = null;
      if (!request.signal.aborted) {
        controller.release();
        setPending(false);
      }
    }
  }

  function retrySession() {
    setMessage("");
    setSession({ status: "checking" });
    setSessionAttempt((attempt) => attempt + 1);
  }

  async function logout() {
    if (!identity || activeRequest.current) return;
    const request = new AbortController();
    activeRequest.current = request;
    setMessage("");
    setPending(true);
    try {
      await signOut(identity.role, request.signal);
      if (!request.signal.aborted) retrySession();
    } catch {
      if (!request.signal.aborted) setMessage(copy.unavailable);
    } finally {
      activeRequest.current = null;
      if (!request.signal.aborted) setPending(false);
    }
  }

  if (identity) {
    return (
      <div className={styles.signedIn} ref={success} tabIndex={-1} aria-label={copy.signedIn}>
        <ShieldCheck className="size-7 text-accent" aria-hidden />
        <p className="font-semibold">{copy.signedIn}</p>
        <p className="break-words text-lg">{identity.name}</p>
        <p className="text-sm text-muted">
          {copy[identity.role]}{identity.role === "reader" && identity.uid ? ` · UID ${identity.uid}` : ""}
          {identity.role === "reader" && identity.vip ? " · VIP" : ""}
        </p>
        <ProfileSettings english={english} personalAccount={identity.role === "reader"} />
        {message && <p role="alert" className={styles.error}>{message}</p>}
        <div className={styles.signedInActions}>
          {identity.role === "owner" && <a href={managementEntry} className={styles.submit}>{copy.openAdmin}</a>}
          <button type="button" onClick={logout} disabled={pending} className={styles.signOut}>
            {pending ? copy.signingOut : copy.signOut}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.form} ref={formRef} method="post" onSubmit={submit} onInput={() => setMessage("")}>
      <label className={styles.field}>
        <span>{copy.email}</span>
        <input className={styles.input} type="email" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required readOnly={pending} />
      </label>
      <div className={styles.field}>
        <label htmlFor="v3-account-password">{copy.password}</label>
        <div className={styles.password}>
          <input id="v3-account-password" type={showPassword ? "text" : "password"} name="password" autoComplete="current-password" required readOnly={pending} />
          <button type="button" className={styles.visibility} aria-controls="v3-account-password" aria-label={showPassword ? copy.hidePassword : copy.showPassword} onClick={() => setShowPassword((shown) => !shown)}>
            {showPassword ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
          </button>
        </div>
      </div>
      {canVerify && (
        <div className={styles.verification}>
          <button type="button" className="login-verification-control" data-login-verification-control data-state="loading" disabled aria-haspopup="dialog" aria-expanded="false" aria-live="polite" aria-busy="true">
            <svg className="login-verification-control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 4 6v6c0 4 4.8 7.4 8 9 3.2-1.6 8-5 8-9V6l-8-3Z" />
              <path data-login-verification-check d="m8 12 3 3 5-6" />
            </svg>
            <span data-login-verification-label>{copy.verifying}</span>
          </button>
        </div>
      )}
      {session.status === "checking" && <p role="status" className="text-sm text-muted">{copy.checkingSession}</p>}
      {(session.status === "unavailable" || message) && (
        <div className={styles.feedback}>
          <p role="alert" className={styles.error}>{session.status === "unavailable" ? copy.unavailable : message}</p>
          {session.status === "unavailable" && <button type="button" onClick={retrySession} className="text-sm font-medium text-accent underline underline-offset-4">{copy.retry}</button>}
        </div>
      )}
      <button type="submit" disabled className={styles.submit} aria-busy={pending}>
        {pending ? copy.signingIn : copy.signIn}
      </button>
      <AccountFlowLinks english={english} requested={requested} current="sign-in" />
    </form>
  );
}
