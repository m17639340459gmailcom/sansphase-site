"use client";

import { Coffee, LockKeyhole, Megaphone } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { communityCopy, demoFieldClass, type CommunityLocale } from "./copy";

const roomThreads = {
  zh: [
    { author: "雾灯", time: "20:16", body: "今晚把《静港》的回看整理成三格了。灯的位置一固定，镜头顺序就好读很多。", imageAlt: "《静港》演示片段三格分镜" },
    { author: "慢粒", time: "20:18", body: "第二格可以多停一下。灯从边缘移动到画面中央时，刚好有余地看清栏杆。", imageAlt: "" },
  ],
  en: [
    { author: "Foglamp", time: "20:16", body: "I reduced the Quiet Harbor review to three frames. Keeping the lamp in a fixed place makes the sequence easier to follow.", imageAlt: "Three sample storyboard frames from Quiet Harbor" },
    { author: "Slow Grain", time: "20:18", body: "I’d hold the second frame a little longer. It gives the viewer time to see the railing as the lamp moves into the middle.", imageAlt: "" },
  ],
};

type Message = { id: number; time: number; body: string };
const recallTime = 5 * 60 * 1000;

export function TeaRoomPreview({ locale }: { locale: CommunityLocale }) {
  const [entered, setEntered] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [now, setNow] = useState(0);
  const copy = communityCopy[locale];

  useEffect(() => {
    const nextDeadline = messages.find((message) => message.time + recallTime > now);
    if (!nextDeadline) return;
    const deadline = nextDeadline.time + recallTime;
    const timeout = window.setTimeout(() => setNow(deadline), Math.max(0, deadline - window.performance.now()));
    return () => window.clearTimeout(timeout);
  }, [messages, now]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    const time = event.timeStamp;
    setMessages((current) => [...current, { id: (current.at(-1)?.id ?? 0) + 1, time, body: text }]);
    setNow(time);
    setBody("");
    setStatus("");
  }

  function recall(message: Message, time: number) {
    setNow(time);
    if (time - message.time >= recallTime) return;
    setMessages((current) => current.filter(({ id }) => id !== message.id));
    setStatus(copy.teaRecalled);
  }

  if (!entered) {
    return (
      <section className="flex min-w-0 flex-col items-start rounded-2xl border border-line bg-bg-elevated p-5 sm:p-8">
        <LockKeyhole aria-hidden className="mb-4 size-6 text-accent" />
        <h2 className="font-display text-xl font-semibold">{copy.locked}</h2>
        <p className="mb-5 mt-2 max-w-xl text-sm leading-7 text-muted">{copy.lockedDescription}</p>
        <Button type="button" onClick={() => setEntered(true)}>{copy.teaEnter}</Button>
      </section>
    );
  }

  return (
    <section aria-label={copy.teaRoom} className="min-w-0 rounded-2xl border border-line bg-bg-elevated">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <div className="inline-flex flex-wrap items-center gap-2">
          <Coffee aria-hidden className="size-5 text-accent" />
          <h2 className="font-display text-lg font-semibold">{copy.teaRoom}</h2>
          <Tag tone="accent">VIP · {copy.preview}</Tag>
        </div>
        <button
          type="button"
          onClick={() => { setEntered(false); setMessages([]); setBody(""); setStatus(""); }}
          className="min-h-10 cursor-pointer rounded-md px-1 text-sm text-muted hover:text-accent"
        >
          {copy.teaLeave}
        </button>
      </div>
      <details open className="border-b border-line bg-accent-soft px-4 py-3 text-sm sm:px-6">
        <summary className="w-fit cursor-pointer font-medium text-accent">
          <span className="inline-flex items-center gap-1.5"><Megaphone aria-hidden className="size-4" />{copy.teaAnnouncement}</span>
        </summary>
        <p className="mt-2 leading-6 text-muted">{copy.teaWelcome}</p>
      </details>
      <ol aria-label={copy.teaLog} className="space-y-5 px-4 py-5 sm:px-6">
        {roomThreads[locale].map(({ author, time, body: text, imageAlt }) => (
          <li key={time} className="space-y-1.5">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted"><strong className="text-fg">{author}</strong><time>{time}</time></p>
            <div className="w-fit max-w-full space-y-3 rounded-xl border border-line bg-bg p-3">
              <p className="text-pretty text-sm leading-6">{text}</p>
              {imageAlt && <Image src="/images/demo-editorial/film-detail.webp" alt={imageAlt} width={960} height={540} unoptimized className="h-auto w-full max-w-64 rounded-lg" />}
            </div>
          </li>
        ))}
        {messages.map((message) => (
          <li key={message.id} className="flex flex-col items-end gap-1.5">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted"><strong className="text-fg">{copy.previewReader}</strong></p>
            <p className="max-w-full whitespace-pre-wrap break-words rounded-xl border border-accent/30 bg-accent-soft p-3 text-sm leading-6">{message.body}</p>
            {now - message.time < recallTime && (
              <button type="button" onClick={(event) => recall(message, event.timeStamp)} className="min-h-10 cursor-pointer rounded-md px-2 text-xs text-muted hover:text-accent">{copy.teaRecall}</button>
            )}
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="space-y-3 border-t border-line p-4 sm:p-6">
        <label className="sr-only" htmlFor="demo-tea-input">{copy.teaInput}</label>
        <textarea aria-label={copy.teaInput} id="demo-tea-input" rows={2} maxLength={300} required value={body}
          onChange={(event) => setBody(event.target.value)} placeholder={copy.teaInput}
          className={`${demoFieldClass} h-20 resize-none overflow-y-auto [scrollbar-color:var(--color-line-strong)_transparent] [scrollbar-width:thin]`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted" role="status">{status}</p>
          <Button type="submit" size="sm" disabled={!body.trim()}>{copy.teaSend}</Button>
        </div>
      </form>
    </section>
  );
}
