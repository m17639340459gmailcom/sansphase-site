// Local preview only: a throwaway community database in the system temp
// directory, seeded with sample members, posts, 星尘, notifications, shop items
// and moderation cases, and removed when the preview stops. There is no real
// sign-in here: every visitor is 预览读者 unless the `preview_as` cookie picks
// another sample member (owner, steward or newbie), for trying each role.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { migrateCommunity } from '../../server/payload/community-migration.ts';
import { createCommunityStore } from '../../server/community-store.ts';
import { createCommunityService } from '../../server/community-service.ts';

// Sample members: nickname, public UID, VIP, days since joining, signature and level (null: computed).
const people = {
  demo: { name: '预览读者', uid: '10001', vip: false, days: 90, bio: '在学 ComfyUI，也在做自己的作品集。', level: 2 },
  linjian: { name: '林间', uid: '10002', vip: false, days: 200, bio: '喜欢画画，也喜欢折腾工作流。', level: 3 },
  yuanshan: { name: '远山', uid: '10003', vip: false, days: 60, bio: '', level: 1 },
  mobai: { name: '墨白', uid: '10004', vip: true, days: 150, bio: '插画师，用 AI 做底图。', level: 2 },
  newbie: { name: '新人小周', uid: '10005', vip: false, days: 2, bio: '', level: 0 },
  steward: { name: '守望', uid: '10006', vip: false, days: 300, bio: '社区协管。', level: 3 },
  spam: { name: '广告号', uid: '10007', vip: false, days: 1, bio: '', level: 0 },
};
const ownerName = '無相';
const member = (id) => id === 'owner' ? { kind: 'owner', id: 'owner' } : { kind: 'reader', id };
const palettes = [['#1c2a4a', '#d9c49c'], ['#3b1f3a', '#e7a9c6'], ['#12343a', '#8fd0c8'], ['#2a2440', '#c9b6f2']];

// A soft gradient poster, re-encoded like a real upload (full size and thumbnail).
async function demoImage(directory, uploader, index, store) {
  const [from, to] = palettes[index % palettes.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="1200" height="1500" fill="url(#g)"/><circle cx="${300 + (index % 4) * 220}" cy="520" r="260" fill="#fff6e0" fill-opacity="0.18"/></svg>`;
  const source = sharp(Buffer.from(svg));
  const id = randomUUID();
  mkdirSync(resolve(directory, 'uploads'), { recursive: true });
  writeFileSync(resolve(directory, 'uploads', `community-image-${id}.webp`), await source.clone().webp({ quality: 82 }).toBuffer());
  writeFileSync(resolve(directory, 'uploads', `community-thumb-${id}.webp`), await source.clone().resize(480, 480, { fit: 'cover' }).webp({ quality: 76 }).toBuffer());
  store.addImage({ id, uploader, width: 1200, height: 1500 });
  return id;
}

export async function createCommunityDemo() {
  const directory = mkdtempSync(resolve(tmpdir(), 'sansphase-community-preview-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  const store = createCommunityStore(directory);
  const now = Date.now();
  const at = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();
  const images = async (author, count, offset) => { const ids = []; for (let i = 0; i < count; i++) ids.push(await demoImage(directory, member(author), offset + i, store)); return ids; };
  const reply = (topicId, author, body, minutesAgo, quoteId = null) => store.addReply({ topicId, author: member(author), body, quoteId, now: at(minutesAgo) }).id;
  for (const id of Object.keys(people)) store.members.agree(member(id), at(60 * 24 * 30));
  // Give most members some 星尘 to spend first. The preview reader's opening
  // balance is explicitly initial credit, so the ledger does not pretend it
  // came from a check-in.
  for (const [id, amount] of [['demo', 800], ['linjian', 900], ['mobai', 400], ['yuanshan', 60], ['steward', 120]]) store.ledger.credit(member(id), amount, 'initial', null, at(60 * 24 * 20));

  const question = store.createTopic({ board: 'qa', author: member('linjian'), title: 'ComfyUI 里 IPAdapter 和 ControlNet 一起用，人脸就崩',
    body: 'IPAdapter 单独用没问题，ControlNet 单独用也没问题。\n\n两个一起接上以后，人脸五官就开始错位。权重都是 **0.8**，模型是 `SDXL`。有人遇到过吗？@远山', tags: ['ComfyUI', '工作流'], bounty: 50, now: at(180) }).id;
  const answer = reply(question, 'yuanshan', '把 IPAdapter 的权重降到 0.5 左右试试，两个都 0.8 的话会互相抢。', 160);
  reply(question, 'mobai', '另外检查一下 ControlNet 的起止步数，人脸细节主要在后半段。\n\n> 起始 0.3，结束 0.9 就够了', 150);
  reply(question, 'demo', '同问，我也遇到过，降权重确实有用。', 140, answer);
  store.accept(answer, at(120));
  const open = store.createTopic({ board: 'qa', author: member('demo'), title: 'Flux 的 LoRA 训练，显存 12G 够吗？',
    body: '手上是一张 4070 Ti，12G 显存。想训一个自己画风的 LoRA，大概 30 张图。\n\n- 需要开哪些省显存的选项？\n- batch size 设多少合适？', tags: ['本地模型', '新手'], bounty: 20, now: at(40) }).id;
  const linjianOpenReply = reply(open, 'linjian', '12G 可以，打开梯度检查点，batch size 1，分辨率先用 768。', 25);
  const work = store.createTopic({ board: 'showcase', author: member('mobai'), title: '用 AI 做了一套节气海报',
    body: '二十四节气做了前六张，底图是生成的，排版和字体是手调的。欢迎提意见。', tags: ['Midjourney', '提示词'],
    images: await images('mobai', 3, 0), meta: { tools: 'Midjourney · Figma', model: 'Midjourney v7', usage: '个人创作，不可商用', prompt: 'solar terms poster, ink wash texture, gold foil accents, minimal layout --ar 4:5 --style raw', promptMode: 'paid', price: 20 }, now: at(600) }).id;
  const linjianWorkReply = reply(work, 'linjian', '立春那张的配色很好看。', 580);
  const tool = store.createTopic({ board: 'tools', author: member('yuanshan'), title: '推荐一个本地跑的语音转文字工具',
    body: '最近在用 whisper.cpp，M 系列芯片上速度很快，中文识别也够用。开源免费，适合整理录音和课程。', tags: ['本地模型', '效率'],
    resource: { url: 'https://github.com/ggerganov/whisper.cpp', kind: '软件', price: '免费', platform: 'macOS · Windows · Linux' }, now: at(1500) }).id;
  const moment = store.createTopic({ board: 'moments', author: member('linjian'), title: '', body: '今天终于把第一个 Agent 跑通了。从读文档到跑通用了三个晚上，最大的收获是：先把任务拆小。',
    tags: ['Claude'], images: await images('linjian', 1, 3), now: at(60) }).id;
  const demoWork = store.createTopic({ board: 'showcase', author: member('demo'), title: '我的第一套星空工作流', body: '用本地模型做了一组星空练习，记录参数和失败的尝试。', tags: ['工作流'], images: await images('demo', 1, 8),
    meta: { tools: 'ComfyUI', model: 'SDXL', usage: '个人创作，不可商用', prompt: '', promptMode: 'public', price: 0 }, now: at(80) }).id;
  store.economy.redeem(member('demo'), 'card-pin', { level: 2, owner: false, joinedAt: at(people.demo.days * 24 * 60), now });
  store.economy.paidPin(demoWork, member('demo'), now - 15 * 60000);
  store.createTopic({ board: 'meta', author: member('owner'), title: '社区开放测试：先读一下社区公约',
    body: '这是本地预览里的示例帖子。发帖、回复、点赞、收藏、签到、兑换都可以试，数据会在预览停止后清除。\n\n觉得处理错了，可以在站务反馈里申诉。', tags: ['新手'], pin: true, now: at(2400) }).id;
  store.createTopic({ board: 'vip', author: member('mobai'), title: '会员茶室：这个月想一起做一个小项目吗', body: '比如每人做一张同主题的海报，月底一起发到作品展廊。', now: at(300) });
  store.createTopic({ board: 'showcase', author: member('linjian'), title: '水墨风格的猫', body: '', tags: ['Stable Diffusion'], images: await images('linjian', 2, 1),
    meta: { tools: 'Stable Diffusion · Krita', model: 'SDXL', usage: '可商用', prompt: 'a cat, ink wash painting, negative space', promptMode: 'public', price: 0 }, now: at(900) });
  // Keep the preview levels honest with a real public catalogue and ordinary
  // interactions, rather than direct level writes or numbered filler replies.
  const progressSpecs = [
    ['qa', '本地模型的显存预算怎么估', '先看分辨率、批量和量化方式，再决定显卡。', 'linjian'],
    ['qa', 'ControlNet 线稿总是跟不住', '把预处理器和模型版本先对齐，权重从 0.6 开始。', 'linjian'],
    ['showcase', '一组低饱和城市海报', '用简单几何和留白做了一次版式练习。', 'linjian'],
    ['showcase', '给旧照片做了光线重建', '保留原构图，只让光影和颗粒更自然。', 'linjian'],
    ['meta', '社区搜索的两个小建议', '希望能按标签和版块一起筛选。', 'linjian'],
    ['tools', '批量整理提示词的本地脚本', '把常用参数归档后，找起来省了很多时间。', 'mobai'],
    ['tools', '一款轻量的图片压缩工具', '适合发帖前处理大图，保留原图比例。', 'mobai'],
    ['showcase', '用纸张纹理做了一张封面', '纹理只作为背景，主体仍然保持清晰。', 'mobai'],
    ['moments', '', '今天把一段很久没整理的素材重新归档了。', 'mobai'],
    ['qa', 'LoRA 数据集怎样保持风格统一', '我会先固定构图，再逐步增加姿态变化。', 'mobai'],
    ['tools', '开源字幕工具的使用记录', '中文断句效果不错，导出前再手动检查一次。', 'yuanshan'],
    ['tools', '桌面端图片标注的小技巧', '先统一命名，再用批处理补齐元数据。', 'yuanshan'],
    ['moments', '', '把失败的参数也记下来，后来复盘时很有用。', 'yuanshan'],
    ['showcase', '第一次做完整的星空练习', '从构图到后期都留下了过程记录。', 'demo'],
  ];
  const progressTopics = progressSpecs.map(([board, title, body, author], i) => store.createTopic({ board, author: member(author), title, body, tags: ['预览'], now: at(2300 + i) }).id);
  const publicTopics = [question, open, work, tool, moment, demoWork, ...progressTopics];
  const linjianReplyTopics = new Set([open, tool, demoWork, ...progressTopics.slice(5, 10), progressTopics[10]]);
  for (const topicId of publicTopics) reply(topicId, linjianReplyTopics.has(topicId) ? 'linjian' : 'demo', '我也遇到过类似情况，先记录下来，之后按这个方向试试。', 2100);
  // Visits are recorded on separate Beijing days; views cover twenty public
  // topics for the members whose preview levels should be visible.
  for (const [id, days] of [['demo', 15], ['linjian', 40], ['mobai', 15], ['yuanshan', 3]]) {
    for (let d = 1; d <= days; d++) store.members.visit(member(id), now - d * 86400e3);
    for (const topicId of publicTopics) store.view(topicId, member(id), now - 1000 * 60000);
  }
  const otherLikers = ['linjian', 'mobai', 'yuanshan', 'newbie', 'steward', 'spam', 'owner'];
  for (const replyId of [linjianOpenReply, linjianWorkReply])
    for (const liker of otherLikers) if (liker !== 'linjian') store.like({ kind: 'reply', id: replyId }, member(liker), true, { rewarding: false, now: at(880) });
  const demoTopics = [demoWork, progressTopics.at(-1)];
  for (const topicId of demoTopics) for (const liker of otherLikers) store.like({ kind: 'topic', id: topicId }, member(liker), true, { rewarding: false, now: at(1000) });
  const linjianTopics = [question, moment, ...progressTopics.slice(0, 5)];
  for (const topicId of linjianTopics) for (const liker of otherLikers) if (liker !== 'linjian') store.like({ kind: 'topic', id: topicId }, member(liker), true, { rewarding: false, now: at(950) });
  const mobaiTopics = [work, ...progressTopics.slice(5, 9)];
  for (const topicId of mobaiTopics) for (const liker of otherLikers) if (liker !== 'mobai') store.like({ kind: 'topic', id: topicId }, member(liker), true, { rewarding: false, now: at(900) });
  for (const topicId of progressTopics.slice(0, 10)) reply(topicId, 'mobai', '这个方向很实用，我会按你的步骤再试一遍。', 800);
  store.setFeatured(question, true, { actor: member('owner'), now: at(700) });
  // A new member's post with a link waits for review; a reported reply is hidden.
  store.createTopic({ board: 'tools', author: member('newbie'), title: '这个网站可以免费抠图', body: '', resource: { url: 'https://example.com/cutout', kind: '网站', price: '免费', platform: '网页' }, pending: '初光等级，帖子带外链', now: at(30) });
  const spam = reply(tool, 'spam', '加我领取全套教程资料，限时免费', 50);
  store.report({ target: { kind: 'reply', id: spam }, reporter: member('linjian'), reporterLevel: 3, reason: '垃圾广告 / 引流', note: '明显是广告' });
  store.hide({ kind: 'reply', id: spam }, '举报：垃圾广告 / 引流');

  // Likes, views, votes, thanks, an unlock and a featured post.
  for (const [topicId, likers] of [[question, ['yuanshan', 'mobai', 'demo']], [work, ['linjian', 'yuanshan', 'demo', 'steward']], [tool, ['mobai', 'linjian']], [moment, ['demo', 'mobai']]])
    for (const liker of likers) { store.like({ kind: 'topic', id: topicId }, member(liker), true, { rewarding: true, now: at(100) }); store.view(topicId, member(liker)); }
  store.like({ kind: 'reply', id: answer }, member('demo'), true, { rewarding: true, now: at(110) });
  for (const [voter, value] of [['linjian', 'alive'], ['mobai', 'alive'], ['demo', 'dead']]) store.vote(tool, member(voter), value, at(200));
  store.thank({ kind: 'reply', id: answer }, member('linjian'), member('yuanshan'), at(115));
  store.economy.unlock(work, member('linjian'), 20, member('mobai'), now - 400 * 60000);
  store.setFeatured(work, true, { actor: member('owner'), now: at(500) });
  store.members.follow(member('linjian'), member('demo'), true, at(70));
  store.members.follow(member('demo'), member('mobai'), true, at(800));

  // 预览读者 checked in for the last six days (today is day 7, +15), wears the gold frame and has a make-up card.
  for (let d = 6; d >= 1; d--) store.economy.checkin(member('demo'), { now: now - d * 86400e3 });
  for (const [id, minutes] of [['linjian', 3], ['mobai', 7], ['steward', 12]]) store.economy.checkin(member(id), { vip: people[id].vip, now: now - minutes * 60000 });
  const context = (id) => ({ level: people[id].level ?? 1, owner: false, joinedAt: at(people[id].days * 24 * 60), now });
  store.economy.redeem(member('demo'), 'frame-gold', context('demo'));
  store.economy.redeem(member('demo'), 'card-makeup', context('demo'));
  store.economy.redeem(member('linjian'), 'color-aurora', context('linjian'));
  store.economy.redeem(member('linjian'), 'cover-aurora', context('linjian'));
  // Items the owner put up: a prompt handbook and a limited tote bag, one waiting to ship.
  const book = store.economy.saveItem(null, { cat: 'digital', name: '無相提示词手册', description: '站长整理的 120 条常用提示词和参数说明，PDF。', price: 40, stock: null, limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '下载链接：https://example.com/prompt-book.pdf\n提取码：wx24（本地预览示例）', note: '', active: true });
  const bag = store.economy.saveItem(null, { cat: 'goods', name: '無相帆布袋', description: '黑色帆布袋，烫金字标。限量 20 个。', price: 300, stock: 20, limitPer: 'year', limitN: 1, minLevel: 1, minDays: 30, delivery: '', note: '包邮', active: true });
  const demoOrder = store.economy.redeem(member('demo'), bag, { ...context('demo'), shipping: { name: '预览读者', phone: '13800138000', address: '浙江省杭州市西湖区示例路 1 号（本地预览示例）' } }).order;
  store.economy.ship(demoOrder, now - 12 * 60000, { company: '顺丰', number: 'SF-PREVIEW-10001' });
  store.economy.redeem(member('linjian'), bag, { ...context('linjian'), shipping: { name: '林间', phone: '13900139000', address: '浙江省杭州市西湖区示例路 2 号（本地预览示例）' } });
  store.economy.redeem(member('mobai'), book, context('mobai'));
  store.members.mute(member('spam'), 7, '垃圾广告 / 引流', member('owner'), now - 3600e3);
  store.members.setSteward(member('steward'), true);
  // A few notifications for 预览读者 beyond the actual shipped order above.
  store.members.notify(member('demo'), { type: 'system', text: '你兑换的物品已经发货', data: { order: 'shipped', item: '無相帆布袋', company: '顺丰', tracking: 'SF-PREVIEW-10001' } }, at(12));
  store.members.notify(member('demo'), { type: 'mention', actor: member('linjian'), topicId: open, text: '在回复里提到了你', data: { where: 'reply' } }, at(24));

  // Show the complete review loop: the owner rejects a demo-authored pending
  // post, leaving the reason and Meta appeal link in the author's inbox.
  const rejected = store.createTopic({ board: 'tools', author: member('demo'), title: '待审核的预览资源', body: '这是会被站长拒绝的本地示例。', pending: '初光等级，帖子带外链', now: at(18) }).id;
  store.rejectTopic(rejected, '与版块无关', '预览中的审核示例', at(10));

  // Trigger the normal level calculation after the evidence is seeded.
  for (const id of Object.keys(people)) store.members.level(member(id), now);

  const byUid = new Map(Object.entries(people).map(([id, info]) => [info.uid, member(id)]));
  const serviceFor = (siteOrigin) => createCommunityService({
    store, siteOrigin, directory, ownerId: 'owner',
    identify: async (req) => {
      const as = /(?:^|;\s*)preview_as=([a-z]+)/.exec(String(req.headers.cookie || ''))?.[1] || 'demo';
      if (as === 'owner') return { kind: 'owner', id: 'owner', name: ownerName, vip: true };
      const info = people[as] || people.demo;
      return { kind: 'reader', id: people[as] ? as : 'demo', name: info.name, vip: info.vip };
    },
    people: async (authors) => new Map(authors.flatMap((author) => {
      if (author.kind === 'owner') return [[`owner:${author.id}`, { name: ownerName, uid: 'owner', avatar: null, vip: true, joinedAt: null, bio: '' }]];
      const info = people[author.id];
      return info ? [[`reader:${author.id}`, { name: info.name, uid: info.uid, avatar: null, vip: info.vip, joinedAt: at(info.days * 24 * 60), bio: info.bio }]] : [];
    })),
    findMember: async (uid) => uid === 'owner' ? member('owner') : byUid.get(uid) || null,
    findByNames: async (names) => new Map([...Object.entries(people).map(([id, info]) => [info.name, member(id)]), [ownerName, member('owner')]].filter(([name]) => names.includes(name))),
    avatarFile: async () => null,
    audit: async () => {},
    words: ['赌博'],
  });
  return {
    // The preview may be opened as 127.0.0.1 or localhost; writes still
    // require the page's own origin, as in production.
    service(port) {
      const services = new Map([`127.0.0.1:${port}`, `localhost:${port}`].map((host) => [host, serviceFor(`http://${host}`)]));
      return { handle: (req, res) => (services.get(req.headers.host) || services.get(`127.0.0.1:${port}`)).handle(req, res) };
    },
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
