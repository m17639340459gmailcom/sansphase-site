import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { communityCopy, toCommunityLocale } from "@/components/community/copy";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";

const guidance = {
  zh: {
    intro: "发帖、回复或进入茶室前，可以先看这份社区规则演示。",
    sections: [
      { title: "交流与内容", body: "对事不对人。尊重其他成员，分享自己核实过的内容，引用资料时注明来源。请勿公布账号、手机号或他人资料。" },
      { title: "选择合适的板块", body: "学习问答写清问题和尝试，作品展廊标注工具和模型，工具资源介绍使用条件。简单观察可以发到随想，网站反馈可以发到站务反馈。" },
      { title: "发布与审核", body: "社区设有内容审核。待审核的帖子在通过前不会出现在公开列表里。这里可以体验待审核状态，演示内容不会进入正式站点。" },
      { title: "会员茶室", body: "有效 VIP、作者、总版主与版主可进入茶室。输入支持文字，聊天记录中也可以展示图片。成员可在五分钟内撤回自己发出的消息。" },
    ],
  },
  en: {
    intro: "Read this preview of the community guidelines before posting, replying or visiting the tea room.",
    sections: [
      { title: "Discussion and content", body: "Discuss ideas with respect. Check what you share and cite your sources. Keep credentials, phone numbers and other people’s private information out of public posts." },
      { title: "Choose a board", body: "Describe the problem and what you tried in Q&A. Credit tools and models in Showcase. Explain usage terms in Tools. Use Moments for short observations and Site feedback for website issues." },
      { title: "Posting and review", body: "The community uses moderation. A pending post is visible in the public feed after approval. This local preview shows what the pending state looks like." },
      { title: "Members’ tea room", body: "Active VIP members, the owner and authorized moderators can enter. Text and images can appear in chat. A member can recall their own message within five minutes." },
    ],
  },
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: language } = await params;
  const locale = toCommunityLocale(language);
  return sansphasePageMetadata(locale, "/community/convention", communityCopy[locale].convention, guidance[locale].intro);
}

export default async function CommunityConventionPage() {
  const locale = toCommunityLocale(await getLocale());
  const copy = communityCopy[locale];
  const { intro, sections } = guidance[locale];
  return (
    <>
      <PageHeader eyebrow={copy.name} title={copy.convention} body={intro} className="sm:pt-36">
        <div><ButtonLink href="/community" variant="secondary">{copy.home}</ButtonLink></div>
      </PageHeader>
      <div className="container-x pb-16 pt-5 sm:pb-24">
        <div className="max-w-3xl overflow-hidden rounded-2xl border border-line bg-bg-elevated divide-y divide-line">
          {sections.map(({ title, body }) => (
            <section key={title} className="px-5 py-6 sm:px-8">
              <h2 className="font-display text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-pretty text-sm leading-7 text-muted">{body}</p>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
