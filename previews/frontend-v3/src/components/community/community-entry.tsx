"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { localizedPath } from "@/i18n/paths";
import { readCommunityAccess, requestCommunityEntry, trustedCommunitySite } from "@/lib/community-entry";
import { communityEntryCopy } from "./entry-copy";

type Status = "checking" | "ready" | "auth" | "pending" | "disabled" | "error" | "unavailable" | "isolated";

export function CommunityEntry({ locale, post }: { locale: keyof typeof communityEntryCopy; post: string | null }) {
  const copy = communityEntryCopy[locale];
  const [status, setStatus] = useState<Status>("checking");
  const [attempt, setAttempt] = useState(0);
  const action = useRef<AbortController>(null);
  const returnTo = localizedPath(locale, "/community") + (post ? `?post=${post}` : "");
  const login = "/account?" + new URLSearchParams({ returnTo }).toString();

  useEffect(() => {
    const check = new AbortController();
    void readCommunityAccess(check.signal).then((access) => {
      if (check.signal.aborted) return;
      setStatus(access === "ready" && !trustedCommunitySite(window.location.origin) ? "isolated" : access);
    }, () => {
      if (!check.signal.aborted) setStatus("unavailable");
    });
    return () => check.abort();
  }, [attempt]);

  useEffect(() => {
    function resume(event: PageTransitionEvent) {
      if (!event.persisted) return;
      action.current?.abort();
      action.current = null;
      setStatus("checking");
      setAttempt((previous) => previous + 1);
    }
    window.addEventListener("pageshow", resume);
    return () => {
      action.current?.abort();
      window.removeEventListener("pageshow", resume);
    };
  }, []);

  async function enter() {
    if (action.current || !trustedCommunitySite(window.location.origin)) return;
    const request = new AbortController();
    action.current = request;
    setStatus("pending");
    try {
      const result = await requestCommunityEntry(post, request.signal);
      if (request.signal.aborted) return;
      if (result.status === "auth") setStatus("auth");
      else window.location.assign(result.destination);
    } catch {
      if (!request.signal.aborted) setStatus("error");
    } finally {
      if (action.current === request) action.current = null;
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {status === "auth" && <ButtonLink href={login} arrow>{copy.account}</ButtonLink>}
      {(status === "ready" || status === "error" || status === "pending") &&
        <Button type="button" disabled={status === "pending"} onClick={() => void enter()} arrow>
          {status === "error" ? copy.retry : copy.enter}
        </Button>}
      {status === "unavailable" && <Button type="button" variant="secondary" onClick={() => {
        setStatus("checking");
        setAttempt((previous) => previous + 1);
      }}>{copy.retry}</Button>}
      <p role="status" className="max-w-sm text-xs leading-5 text-muted">{copy[status]}</p>
    </div>
  );
}
