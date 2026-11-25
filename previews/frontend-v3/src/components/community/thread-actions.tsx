"use client";

import { ThumbsUp } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { communityCopy, demoFieldClass, type CommunityLocale } from "./copy";

export function DemoLike({ locale, count }: { locale: CommunityLocale; count: number }) {
  const [liked, setLiked] = useState(false);
  const label = communityCopy[locale].likes(count + Number(liked));
  return (
    <button
      type="button"
      aria-pressed={liked}
      onClick={() => setLiked((value) => !value)}
      className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm text-muted hover:border-accent/40 hover:text-accent aria-pressed:border-accent/40 aria-pressed:bg-accent-soft aria-pressed:text-accent"
    >
      <ThumbsUp aria-hidden className="size-4" />{label}
    </button>
  );
}

export function DemoReplyForm({ locale }: { locale: CommunityLocale }) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [replies, setReplies] = useState<string[]>([]);
  const copy = communityCopy[locale];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text) {
      setStatus(copy.replyValidation);
      return;
    }
    setReplies((current) => [...current, text]);
    setBody("");
    setStatus(copy.replyAdded);
  }

  return (
    <>
      {replies.length > 0 && (
        <ol aria-label={copy.localReply} className="mt-3 space-y-3">
          {replies.map((text, index) => (
            <li key={index} className="rounded-xl border border-line bg-bg-elevated p-4 sm:p-5">
              <div className="mb-2 flex flex-wrap items-center gap-2"><strong>{copy.previewReader}</strong><Tag>{copy.localReply}</Tag></div>
              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-muted">{text}</p>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={submit} className="mt-6 space-y-3 rounded-2xl border border-line bg-bg-elevated p-4 sm:p-6">
        <label htmlFor="demo-reply" className="block font-display font-semibold">{copy.replyTitle}</label>
        <textarea
          id="demo-reply" rows={3} maxLength={600} required value={body} placeholder={copy.replyPlaceholder}
          onChange={(event) => { setBody(event.target.value); setStatus(""); }}
          className={`${demoFieldClass} resize-y`}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-xs text-muted">{status}</p>
          <Button type="submit" size="sm">{copy.replySubmit}</Button>
        </div>
      </form>
    </>
  );
}
