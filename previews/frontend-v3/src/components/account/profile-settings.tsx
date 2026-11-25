"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { AccountRequestError, readPersonalProfile, removeReaderAvatar, saveReaderProfile, uploadReaderAvatar } from "@/lib/account-session";
import { membershipSummary } from "@/shared/site/reader-membership.mjs";
import { validReaderNickname } from "@/shared/site/reader-policy.mjs";
import { accountWorkflowCopy } from "./account-copy";
import { FormFeedback, formText, useAccountAction } from "./account-form";
import styles from "./sign-in.module.css";

type Profile = NonNullable<Awaited<ReturnType<typeof readPersonalProfile>>>;

export function ProfileSettings({ english, personalAccount }: { english: boolean; personalAccount: boolean }) {
  const copy = english ? accountWorkflowCopy.en : accountWorkflowCopy.zh;
  const action = useAccountAction(english);
  const file = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [formRevision, setFormRevision] = useState(0);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());

  useEffect(() => {
    const request = new AbortController();
    void readPersonalProfile(request.signal).then((current) => {
      if (request.signal.aborted) return;
      setProfile(current);
      setCheckedAt(Date.now());
    }, () => {
      if (!request.signal.aborted) setLoadError(true);
    });
    return () => request.abort();
  }, [attempt]);

  useEffect(() => {
    if (!profile?.vip || !profile.vipUntil || action.pending) return;
    const expiresAt = Date.parse(profile.vipUntil);
    const request = new AbortController();
    let refreshing = false;
    const tick = async () => {
      if (document.hidden) return;
      const now = Date.now();
      setCheckedAt(now);
      if (now < expiresAt || refreshing) return;
      refreshing = true;
      try {
        const current = await readPersonalProfile(request.signal);
        if (!request.signal.aborted) setProfile(current);
      } catch { /* An unavailable server does not change confirmed membership. */ }
      finally { refreshing = false; }
    };
    const timer = setInterval(() => { void tick(); }, 60_000);
    const onVisibility = () => { void tick(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      request.abort();
    };
  }, [action.pending, profile?.vip, profile?.vipUntil]);

  async function refresh(signal: AbortSignal) {
    const current = await readPersonalProfile(signal);
    if (signal.aborted) return;
    setProfile(current);
    setCheckedAt(Date.now());
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const nickname = formText(values, "nickname").trim().normalize("NFC");
    if (!validReaderNickname(nickname)) { action.showError(copy.invalidNickname); return; }
    const phone = formText(values, "phone").trim();
    void action.run(async (signal) => {
      const reviewPending = await saveReaderProfile({ nickname, signature: formText(values, "signature"),
        ...(phone ? { phone } : {}) }, signal);
      await refresh(signal);
      if (!signal.aborted) setFormRevision((revision) => revision + 1);
      return reviewPending ? copy.profilePending : copy.profileSaved;
    });
  }

  function upload(event: ChangeEvent<HTMLInputElement>) {
    const candidate = event.target.files?.[0];
    event.target.value = "";
    if (!candidate) return;
    void action.run(async (signal) => {
      const { prepareUploadImage } = await import("@/shared/site/upload-image.mjs");
      let prepared: File;
      try { prepared = await prepareUploadImage(candidate, { signal }); }
      catch (error) {
        throw new AccountRequestError("invalidDetails", error instanceof Error ? error.message : undefined);
      }
      await uploadReaderAvatar(prepared, signal);
      await refresh(signal);
      return copy.avatarPending;
    }, copy.avatarFailed);
  }

  function removeAvatar() {
    void action.run(async (signal) => {
      await removeReaderAvatar(signal);
      await refresh(signal);
      return copy.avatarRemoved;
    }, copy.avatarFailed);
  }

  if (!profile) {
    return personalAccount && loadError ? (
      <button type="button" className={styles.textAction} onClick={() => {
        setLoadError(false);
        setAttempt((previous) => previous + 1);
      }}>{copy.refreshProfile}</button>
    ) : null;
  }

  const membership = membershipSummary(profile, checkedAt, english);
  const expiry = membership.until ? new Intl.DateTimeFormat(english ? "en" : "zh-CN", {
    dateStyle: "medium", timeStyle: "short",
  }).format(new Date(membership.until)) : null;
  const membershipLabel = membership.active ? "VIP" : membership.status === "expired" ? copy.expired : copy.reader;
  const phoneRequired = !profile.ownerReader || Boolean(profile.phone);

  return (
    <section className={styles.profile} aria-label={copy.profile}>
      <div className={styles.profileHeader}>
        <span className={styles.avatar} aria-hidden="true">
          {profile.avatar ? <Image src={profile.avatar} alt="" width={52} height={52} unoptimized /> :
            Array.from(profile.nickname.trim())[0] || "✦"}
        </span>
        <div className={styles.profileDetails}>
          {!personalAccount && <h2>{profile.nickname}</h2>}
          <p className={styles.message}>{profile.email}</p>
          {profile.signature && <p className={styles.message}>{profile.signature}</p>}
        </div>
      </div>
      <dl className={styles.membership}>
        <div><dt>{copy.membership}</dt><dd>{membershipLabel}</dd></div>
        {membership.active && <div><dt>{copy.remaining}</dt><dd>{membership.remaining}</dd></div>}
        {membership.until && expiry && <div><dt>{copy.expiry}</dt><dd><time dateTime={membership.until}>{expiry}</time></dd></div>}
      </dl>
      <details className={styles.profileEditor}>
        <summary>{copy.profileSetting}</summary>
        <p className={styles.message}>{copy.profileReview}</p>
        <form key={formRevision} className={styles.form} method="post" onSubmit={save} onInput={action.clearFeedback}>
          <label className={styles.field}>
            <span>{copy.nickname}{profile.pendingNickname !== null && <small className={styles.message}> · {copy.pendingReview}</small>}</span>
            <input className={styles.input} name="nickname" autoComplete="nickname" defaultValue={profile.pendingNickname ?? profile.nickname} maxLength={128} required readOnly={action.pending} />
          </label>
          <label className={styles.field}>
            <span>{copy.signature}{profile.pendingSignature !== null && <small className={styles.message}> · {copy.pendingReview}</small>}</span>
            <input className={styles.input} name="signature" maxLength={100} defaultValue={profile.pendingSignature ?? profile.signature ?? ""} readOnly={action.pending} />
          </label>
          <label className={styles.field}>
            <span>{copy.profilePhone}</span>
            <input className={styles.input} type="tel" name="phone" autoComplete="tel" inputMode="numeric" pattern="1[3-9][0-9]{9}" maxLength={11} defaultValue={profile.phone} required={phoneRequired} readOnly={action.pending} />
          </label>
          <button type="submit" className={styles.submit} disabled={action.pending} aria-busy={action.pending}>
            {action.pending ? copy.working : copy.saveProfile}
          </button>
        </form>
        <div className={styles.avatarActions} role="group" aria-label={copy.avatar}>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={upload} />
          <button type="button" className={styles.textAction} disabled={action.pending} onClick={() => file.current?.click()}>{copy.uploadAvatar}</button>
          {(profile.avatar || profile.pendingAvatar) && (
            <button type="button" className={styles.textAction} disabled={action.pending} onClick={removeAvatar}>{copy.removeAvatar}</button>
          )}
        </div>
        {profile.pendingAvatar && <p className={styles.message}>{copy.avatarPending}</p>}
        <FormFeedback feedback={action.feedback} />
      </details>
    </section>
  );
}
