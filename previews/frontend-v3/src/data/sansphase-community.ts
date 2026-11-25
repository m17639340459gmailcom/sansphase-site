import type { LocalizedText } from "./sansphase";

const bi = (zh: string, en: string): LocalizedText => ({ zh, en });

export const demoBoards = [
  { id: "qa", name: bi("学习问答", "Q&A"), description: bi("说清要解决的问题、已经试过的办法，以及卡在哪里。", "Explain the question, what you tried and where you got stuck."), tip: bi("写清环境和复现步骤，解决后回来补充答案。", "Include your setup and steps, then add the solution when you find one.") },
  { id: "showcase", name: bi("作品展廊", "Showcase"), description: bi("分享作品、制作工具和过程中的取舍。", "Share your work, the tools you used and decisions you made."), tip: bi("标注使用的工具和模型，分享你自己的作品。", "Credit your tools and models and share only your own work.") },
  { id: "tools", name: bi("工具资源", "Tools"), description: bi("交流亲手用过的软件、教程与可复用的资料。", "Talk about software, tutorials and resources you have used."), tip: bi("写清资源的适用场景、使用条件和来源。", "Include the use case, terms and source of a resource.") },
  { id: "moments", name: bi("随想", "Moments"), description: bi("给尚未成文的观察和点子留个位置。", "A place for small observations and unfinished ideas."), tip: bi("简短记录即可，讨论想法，尊重每位成员。", "Keep it short, discuss ideas and respect other members.") },
  { id: "meta", name: bi("站务反馈", "Site feedback"), description: bi("收集社区使用中的问题、建议与公告。", "Find announcements and give feedback on the community."), tip: bi("反馈问题时，附上页面位置、设备和操作顺序。", "When reporting a problem, include the page, device and steps.") },
  { id: "vip", name: bi("会员茶室", "Members’ tea room"), description: bi("会员与有权限的管理成员的文字、图片聊天室。", "A text and image chat for members and authorized staff."), tip: bi("茶室里的交流适用社区公约。", "The community guidelines apply in the tea room.") },
] as const;

export type DemoBoardId = (typeof demoBoards)[number]["id"];
export type DemoPublicBoardId = Exclude<DemoBoardId, "vip">;
export const publicDemoBoards = demoBoards.filter((board) => board.id !== "vip");
export const getDemoBoard = (id: string) => demoBoards.find((board) => board.id === id);
export const communityBoardHref = (id: DemoBoardId) => `/community/boards/${id}`;
export const communityTopicHref = (id: string) => `/community/post/${id}`;

const people = {
  shore: bi("纸岸", "Paper Shore"),
  fog: bi("雾灯", "Foglamp"),
  grain: bi("慢粒", "Slow Grain"),
  thread: bi("返线", "Return Thread"),
  pine: bi("松屿", "Pine Islet"),
  wind: bi("拾风", "Windkeeper"),
} satisfies Record<string, LocalizedText>;

type DemoReply = { author: LocalizedText; date: string; text: LocalizedText; accepted?: boolean };
type DemoTopic = {
  id: string;
  board: DemoPublicBoardId;
  title: LocalizedText;
  excerpt: LocalizedText;
  body: { zh: readonly string[]; en: readonly string[] };
  author: LocalizedText;
  published: string;
  tags: readonly LocalizedText[];
  likes: number;
  views: number;
  featured?: boolean;
  replies: readonly DemoReply[];
  cover?: { src: string; alt: LocalizedText };
  related?: { href: string; title: LocalizedText };
};

export const demoTopics: readonly DemoTopic[] = [
  {
    id: "clip-timing-notes", board: "qa", author: people.shore, published: "2026-11-23", likes: 17, views: 232, featured: true,
    title: bi("12 秒短片的旁白总比画面晚半拍，怎么定位？", "Why is the voice-over half a beat late in a 12-second film?"),
    excerpt: bi("导入旁白后，前三秒看着正常，切到第二个镜头才开始觉得别扭。", "The first three seconds feel right. The mismatch starts on the second shot."),
    tags: [bi("短片工作流", "Short-film workflow"), bi("剪辑", "Editing")],
    body: {
      zh: ["我在做一段 12 秒的虚构短片《晨线》。第一镜是空走廊，第二镜出现人影。导出时旁白像晚了半拍，但逐帧看时，时间线上的波形和记号都对着。", "我试过把整条旁白提前两帧，开场反而显得急。想请教大家是先校准声音进入点，还是先考虑镜头本身的停留时间？"],
      en: ["I’m making a fictional 12-second piece called First Light. The first shot shows an empty corridor and the second brings in a figure. The export feels half a beat late, even though the waveform lines up with the markers.", "Moving the entire voice-over two frames earlier made the opening feel rushed. Would you check the cue first or adjust how long the shot holds?"],
    },
    replies: [
      { author: people.fog, date: "2026-11-23", text: bi("先只放第二镜前后两秒，关掉音乐听一遍。波形起点往往是呼吸，真正可辨识的第一个音节会晚几帧。", "Loop two seconds around the second shot and mute the music. The waveform often starts with a breath, while the first intelligible syllable arrives a few frames later."), accepted: true },
      { author: people.shore, date: "2026-11-24", text: bi("确认了，原来标在吸气上。重新标记第一个音节，再多留一帧给人影，试听顺了很多。", "Confirmed: my marker was on an inhale. Marking the first syllable and giving the figure one more frame made the review feel much smoother.") },
    ],
    related: { href: "/blog/ai-short-video-workflow-consolidation", title: bi("读短片制作交接复盘", "Read the film handoff notes") },
  },
  {
    id: "blue-hour-test", board: "showcase", author: people.fog, published: "2026-11-22", likes: 24, views: 318, featured: true,
    title: bi("《静港》蓝调时间试片：三格分镜怎么接", "Quiet Harbor at blue hour: three frames in sequence"),
    excerpt: bi("试片只保留蓝、灰和一盏暖灯，用分镜回看检查运动方向。", "A blue-gray test with one warm light, reviewed frame by frame to check motion."),
    tags: [bi("分镜", "Storyboard"), bi("AI 影像", "AI video")],
    cover: { src: "/images/demo-editorial/film-detail.webp", alt: bi("短片分镜回看流程的三格演示图", "A three-frame illustration of short-film review") },
    body: {
      zh: ["这次做了一个虚构港口的三镜片段：外景交代水面，中景让光沿栏杆移动，近景只看灯罩的反光。先用分镜工具排镜头，再在剪辑时间线上统一色温。", "第一稿每个镜头都加了摇动，反而看不清暖灯的位置。最后只保留中景的横移，另外两镜维持固定机位。"],
      en: ["This fictional harbor sequence has three shots: a wide view of the water, a moving light along a railing and a close-up on the lamp reflection. I arranged the shots in a storyboard, then matched the color temperature on the editing timeline.", "I gave every shot camera movement in the first draft, which hid the lamp’s position. In the final test, only the middle shot moves."],
    },
    replies: [
      { author: people.grain, date: "2026-11-23", text: bi("中景当桥梁很实用，顺着同一方向看过去，第三个镜头里的灯很容易认出来。", "The middle shot works as a bridge. Keeping the direction makes it easy to recognize the lamp in the third shot.") },
      { author: people.wind, date: "2026-11-24", text: bi("手机屏幕上第二镜的栏杆有些暗，测试时可以顺手加一段纯暗度对照。", "The railing is quite dark on my phone. A brightness-only comparison would be helpful in the next test.") },
    ],
    related: { href: "/blog/ai-short-video-workflow-retrospective", title: bi("读《静港》看片记录", "Read the Quiet Harbor review") },
  },
  {
    id: "shot-review-sheet", board: "tools", author: people.thread, published: "2026-11-20", likes: 12, views: 188, featured: true,
    title: bi("分享一张镜头验收表：把意见写在同一条记录里", "A shot review sheet that keeps feedback in one record"),
    excerpt: bi("用编号、时间点、现象、修订动作和确认人五列跟进审片意见。", "Five columns track a shot ID, timecode, observation, revision and reviewer."),
    tags: [bi("创作模板", "Creative templates"), bi("项目复盘", "Retrospective")],
    body: {
      zh: ["试着把每一条意见写成「位置＋现象＋动作」。例如 00:06 字幕进入太早，留八帧给音效，而不是只写一句节奏怪。", "多个人看同一个版本时，还会加上最后确认人一列。确认过的改动留在表里，下一版就能用同一处时间点复查。"],
      en: ["I write every note as a location, an observation and an action. For example: at 00:06 the captions appear early; leave eight frames for the sound cue.", "When several people review the same cut, I add a final-reviewer column. Confirmed notes stay in the sheet so the next version can use the same timecode for a second look."],
    },
    replies: [{ author: people.pine, date: "2026-11-21", text: bi("再加一列片源版本就很稳，时间点会跟着剪辑变化。", "A cut-version column would help when changes shift the timecodes.") }],
    related: { href: "/learning", title: bi("打开资料里的检查清单", "Open the checklists in Learning") },
  },
  {
    id: "back-to-one-shot", board: "moments", author: people.grain, published: "2026-11-21", likes: 9, views: 108,
    title: bi("先把一个镜头讲清楚", "Start by making one shot clear"),
    excerpt: bi("总想把新点子都放进去，今天把测试缩成了一个镜头。", "I wanted every new idea in the test. Today I cut it back to one shot."),
    tags: [bi("创作记录", "Creative notes")],
    body: {
      zh: ["那段镜头原本有字幕、光晕和三段环境音。临时抽掉两层，才发现观众需要的是一个停下来观察的时间点。", "下一次试片先保留最必要的提示，放完一遍，再决定该补哪一层。"],
      en: ["The shot started with captions, bloom and three ambience layers. I took two layers out and noticed the audience mainly needed a moment to look.", "For the next test I’ll keep the necessary cue, run the clip once and then decide what to add."],
    },
    replies: [{ author: people.fog, date: "2026-11-22", text: bi("这个办法也适合剪采访，先保留一口气能说清的那句。", "That works for interviews too. Keep the sentence that makes its point in one breath.") }],
  },
  {
    id: "report-mobile-reading", board: "meta", author: people.pine, published: "2026-11-19", likes: 6, views: 132,
    title: bi("手机读长帖，建议回到原来的段落位置", "Remember the reading position on mobile threads"),
    excerpt: bi("从资料页返回长帖会回到顶部，希望能继续读刚刚那一段。", "Returning from a resource starts the thread at the top. I’d like to resume where I was."),
    tags: [bi("使用反馈", "Feedback"), bi("移动端", "Mobile")],
    body: {
      zh: ["用约 390 像素宽的手机看长帖时，先读到第二条回复，再打开作者推荐的模板。返回后顶部标题重新出现，要再找一次那条回复。", "建议返回时优先恢复上一次的阅读位置。复制分享地址时仍保持帖子链接干净，方便别人直接打开。"],
      en: ["On a phone about 390 pixels wide, I read through the second reply and opened a suggested template. When I returned, the thread opened at the heading and I had to find the reply again.", "Restoring the last reading position on back navigation would help. The shared URL could still be the plain thread link."],
    },
    replies: [{ author: people.thread, date: "2026-11-20", text: bi("我加一条复现信息：从站内资料返回也有同样现象。", "An extra repro detail: it also happens when going back from an internal resource.") }],
  },
  {
    id: "captions-path", board: "qa", author: people.wind, published: "2026-11-18", likes: 13, views: 194,
    title: bi("片尾字幕换到另一台电脑就丢字，应该先查哪里？", "Where should I check when end captions lose glyphs on another computer?"),
    excerpt: bi("同一份字幕在两台电脑上渲染不同，想检查字体引用和台词文件的编码。", "Two machines render the same captions differently. I want to check the font and file encoding."),
    tags: [bi("字幕", "Captions"), bi("排查", "Troubleshooting")],
    body: {
      zh: ["虚构项目《返航》的片尾字幕在剪辑电脑上正常，换到另一台机器预览时，两个生僻字被显示成小方块。文本文件是从同一个目录复制过去的。", "有什么办法能区分缺字体、字体回退或文件编码的问题？我希望先弄清原因，再确定片尾用哪套字。"],
      en: ["The end captions of the fictional film Homeward look correct on the editing machine. On a second computer, two unusual characters become squares, even though the same text file was copied over.", "How can I separate missing font coverage, font fallback and encoding issues before deciding on a typeface?"],
    },
    replies: [{ author: people.shore, date: "2026-11-18", text: bi("先在新机器的系统文本编辑器贴那两个字。能显示就确认应用使用了哪套字体，不能显示就检查渲染字库是否覆盖。", "Paste the two glyphs into the other machine’s text editor. If they appear there, check the font used by the app. If they do not, check glyph coverage."), accepted: true }],
  },
  {
    id: "poster-color-test", board: "showcase", author: people.grain, published: "2026-11-17", likes: 16, views: 247,
    title: bi("创作档案封面：两种蓝紫配色的缩略图测试", "Creative archive cover: testing blue and violet thumbnails"),
    excerpt: bi("在深浅主题里分别检查一张封面缩小后文字和线条的可读性。", "Testing the cover’s type and rules as a thumbnail in both color themes."),
    tags: [bi("封面设计", "Cover design"), bi("阅读体验", "Reading experience")],
    cover: { src: "/images/demo-editorial/star-window.webp", alt: bi("星窗创作档案的虚构深色封面", "The fictional Star Window creative archive cover") },
    body: {
      zh: ["我把「星窗档案」的封面缩到卡片尺寸，对照了蓝灰底配浅字和深紫底配带色字两种方案。后者离近看辨识度好，缩小时副标题变得模糊。", "这版用浅字保主标题，将带色信息保留在小标签和细线里。深浅主题都使用同一个文件，避免出现两套不同内容。"],
      en: ["I shrank the fictional Star Window Archive cover to card size. Light type on blue-gray held up better than tinted type on deep violet, especially in the subtitle.", "The new test keeps the title light and uses color in labels and rules. Both site themes display the same file."],
    },
    replies: [{ author: people.pine, date: "2026-11-19", text: bi("两列显示时细线刚刚好，建议再对比一列手机卡片的副标题行数。", "The rules look right when the grid has two columns. I’d also check the subtitle wrap with one column on a phone.") }],
  },
  {
    id: "local-file-index", board: "tools", author: people.shore, published: "2026-11-16", likes: 21, views: 276,
    title: bi("做一个本地文件索引，先记来源再记结论", "Building a local file index around sources before conclusions"),
    excerpt: bi("把虚构项目「潮汐档案」里的笔记按来源、版本、状态记录。", "Notes in the fictional Tide Archive are indexed by source, version and status."),
    tags: [bi("个人知识库", "Knowledge base"), bi("资料管理", "Research records")],
    body: {
      zh: ["做资料索引时容易把自己的判断写成原作者的结论。新的做法是把原文位置和自己的备注隔两列，查阅时先点回来源。", "我给每条备注加上待核验、已核验或已替换的状态。这样下一版修改结论时，还能知道当初为什么采用这一条。"],
      en: ["An index can accidentally attribute my judgement to a source. I put the source location and my notes in separate columns, and open the source first during review.", "A note can be unverified, checked or superseded. When a conclusion changes, I can trace why we used it in the earlier version."],
    },
    replies: [{ author: people.wind, date: "2026-11-17", text: bi("最近在整理音效来源，用是否允许商用作为另一列，似乎也适用。", "I am cataloguing sound sources. A column for commercial-use terms would fit the same approach.") }],
    related: { href: "/resources", title: bi("查看资源中心的笔记手册", "Find the notes handbook in the library") },
  },
];

export const getDemoTopic = (id: string) => demoTopics.find((topic) => topic.id === id);
export const demoTopicSorts = ["all", "featured", "newest", "active"] as const;
export type DemoTopicSort = (typeof demoTopicSorts)[number];

export type DemoTopicSummary = Pick<DemoTopic, "id" | "board" | "title" | "excerpt" | "tags" | "author" | "featured" | "published" | "cover" | "likes" | "views">
  & { replies: readonly Pick<DemoReply, "date" | "accepted">[] };

export const demoTopicSummaries: readonly DemoTopicSummary[] = demoTopics.map(({ id, board, title, excerpt, tags, author, featured, published, cover, likes, views, replies }) => ({
  id, board, title, excerpt, tags, author, featured, published, cover, likes, views,
  replies: replies.map(({ date, accepted }) => ({ date, accepted })),
}));

export function selectDemoTopics<T extends DemoTopicSummary>(
  topics: readonly T[],
  { locale, board, query = "", sort = "all" }: {
    locale: "zh" | "en";
    board?: DemoBoardId;
    query?: string;
    sort?: DemoTopicSort;
  },
): T[] {
  const words = query.trim().toLocaleLowerCase(locale).split(/\s+/).filter(Boolean);
  const filtered = topics.filter((topic) => {
    if ((board && topic.board !== board) || (sort === "featured" && !topic.featured)) return false;
    if (words.length === 0) return true;
    const text = [topic.title, topic.excerpt, topic.author, ...topic.tags]
      .map((value) => value[locale]).join(" ").toLocaleLowerCase(locale);
    return words.every((word) => text.includes(word));
  });
  const date = (topic: T) => sort === "active" ? (topic.replies.at(-1)?.date ?? topic.published) : topic.published;
  return filtered.sort((a, b) => date(b).localeCompare(date(a)));
}
