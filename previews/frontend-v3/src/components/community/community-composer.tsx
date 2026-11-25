"use client";

import { Clock3, FilePenLine } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { demoTopics, publicDemoBoards, type DemoPublicBoardId } from "@/data/sansphase-community";
import { Link } from "@/i18n/navigation";
import { communityCopy, demoFieldClass, type CommunityLocale } from "./copy";

export function CommunityComposer({ locale, initialBoard }: { locale: CommunityLocale; initialBoard: DemoPublicBoardId }) {
  const [board, setBoard] = useState(initialBoard);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const copy = communityCopy[locale];
  const boardLabel = publicDemoBoards.find(({ id }) => id === board)?.name[locale];
  const maxLength = board === "moments" ? 300 : 10000;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError(copy.validation);
      return;
    }
    if (body.length > maxLength) {
      setError(copy.lengthValidation);
      return;
    }
    setError("");
    setPending(true);
  }

  function useExample() {
    const example = demoTopics.find((topic) => topic.board === board);
    if (!example) return;
    setTitle(example.title[locale]);
    setBody(example.body[locale].join("\n\n").slice(0, maxLength));
    setError("");
  }

  if (pending) {
    return (
      <section className="min-w-0 rounded-2xl border border-line bg-bg-elevated p-5 sm:p-8" aria-labelledby="demo-post-pending">
        <div className="flex flex-wrap items-center gap-2"><Tag tone="accent"><Clock3 aria-hidden className="size-3.5" />{copy.pending}</Tag><Tag>{boardLabel}</Tag></div>
        <h2 id="demo-post-pending" className="mt-4 break-words font-display text-2xl font-semibold" role="status">{title.trim()}</h2>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-muted">{body.trim()}</p>
        <p className="my-5 rounded-lg border border-line bg-bg px-3.5 py-3 text-sm text-muted">{copy.pendingDescription}</p>
        <div className="flex flex-wrap gap-2.5">
          <ButtonLink href="/community" arrow>{copy.home}</ButtonLink>
          <Button variant="secondary" type="button" onClick={() => { setPending(false); setTitle(""); setBody(""); }}>{copy.writeAnother}</Button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="min-w-0 space-y-5 rounded-2xl border border-line bg-bg-elevated p-5 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tag tone="accent"><FilePenLine aria-hidden className="size-3.5" />{copy.previewReader}</Tag>
        <Button type="button" variant="secondary" size="sm" onClick={useExample}>{locale === "zh" ? "填入一篇样例" : "Fill with a sample"}</Button>
      </div>
      <div className="space-y-2">
        <label htmlFor="community-demo-board" className="block text-sm font-medium">{copy.formBoard}</label>
        <select
          id="community-demo-board" value={board} className={demoFieldClass}
          onChange={(event) => {
            const selected = publicDemoBoards.find(({ id }) => id === event.target.value);
            if (!selected) return;
            setBoard(selected.id);
            setError("");
            const url = new URL(window.location.href);
            url.searchParams.set("board", selected.id);
            window.history.replaceState(null, "", url);
          }}
        >
          {publicDemoBoards.map(({ id, name }) => <option key={id} value={id}>{name[locale]}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor="community-demo-title" className="block text-sm font-medium">{copy.formTitle}</label>
        <input id="community-demo-title" className={demoFieldClass} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={100} placeholder={copy.formTitlePlaceholder} />
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="community-demo-body" className="block text-sm font-medium">{copy.formBody}</label>
          <span aria-hidden className="font-mono text-xs text-muted">{body.length} / {maxLength}</span>
        </div>
        <textarea
          id="community-demo-body" className={`${demoFieldClass} resize-y`} rows={6} value={body} onChange={(event) => setBody(event.target.value)}
          required maxLength={maxLength} placeholder={copy.formBodyPlaceholder}
        />
      </div>
      {error && <p role="alert" className="text-sm text-accent">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/community/convention" className="text-sm font-medium text-muted underline decoration-line-strong underline-offset-4 hover:text-accent">{copy.convention}</Link>
        <Button type="submit" arrow>{copy.submit}</Button>
      </div>
    </form>
  );
}
