import { relativeTime, beijingTime } from "../community.ts";

type TimeChange = {
  time: HTMLTimeElement;
  children: ChildNode[];
  datetime: string | null;
  title: string | null;
  text: Text;
  appliedDatetime: string;
  appliedTitle: string;
};

const restoreAttribute = (time: HTMLTimeElement, name: string, original: string | null) => {
  if (original === null) time.removeAttribute(name);
  else time.setAttribute(name, original);
};
function restore(change: TimeChange) {
  const { time, text, children } = change;
  if (time.childNodes.length === 1 && time.firstChild === text) time.replaceChildren(...children);
  if (time.getAttribute("datetime") === change.appliedDatetime) restoreAttribute(time, "datetime", change.datetime);
  if (time.getAttribute("title") === change.appliedTitle) restoreAttribute(time, "title", change.title);
}
function current(change: TimeChange) {
  return change.time.childNodes.length === 1 && change.time.firstChild === change.text
    && change.time.getAttribute("datetime") === change.appliedDatetime
    && change.time.getAttribute("title") === change.appliedTitle;
}

/** The feed publication label; the original latest-reply time remains fully reversible. */
export function createFeedPublicationTime(host: HTMLElement): { sync: () => void; release: () => void } {
  const changes = new Map<HTMLTimeElement, TimeChange>();
  return {
    sync: () => {
      const heading = host.querySelector(".community-banner h1")?.textContent?.trim();
      const english = heading ? heading === "Community" : host.ownerDocument.documentElement.lang.startsWith("en");
      const t = (zh: string, en: string) => english ? en : zh;
      const seen = new Set<HTMLTimeElement>();
      for (const topic of host.querySelectorAll<HTMLElement>(".community-topic")) {
        const createdAt = topic.getAttribute("data-created-at");
        const time = topic.querySelector<HTMLTimeElement>(":scope > .community-topic-main > .community-feed-byline > time");
        if (!createdAt || !Number.isFinite(Date.parse(createdAt)) || !time) continue;
        let label: string, title: string;
        try {
          const relative = relativeTime(createdAt, Date.now(), t);
          label = english ? `Published ${relative}` : `${relative}发布`;
          title = `${beijingTime(createdAt, true)} ${english ? "(Beijing time)" : "（北京时间）"}`;
        } catch { continue; }
        seen.add(time);
        let change = changes.get(time);
        if (change && !current(change)) {
          // A renderer may update the existing node. Keep those new source values
          // instead of restoring an obsolete reply when the feed exits.
          restore(change);
          changes.delete(time);
          change = undefined;
        }
        if (!change) {
          const text = host.ownerDocument.createTextNode(label);
          change = {
            time, children: Array.from(time.childNodes), datetime: time.getAttribute("datetime"), title: time.getAttribute("title"),
            text, appliedDatetime: createdAt, appliedTitle: title,
          };
          time.replaceChildren(text);
          changes.set(time, change);
        }
        if (change.text.data !== label) change.text.data = label;
        if (time.getAttribute("datetime") !== createdAt) time.setAttribute("datetime", createdAt);
        if (time.getAttribute("title") !== title) time.setAttribute("title", title);
        change.appliedDatetime = createdAt;
        change.appliedTitle = title;
      }
      for (const [time, change] of changes) {
        if (seen.has(time)) continue;
        restore(change);
        changes.delete(time);
      }
    },
    release: () => {
      for (const change of changes.values()) restore(change);
      changes.clear();
    },
  };
}
