/** Approved community achievements. Server and browser share this one policy. */
export const communityBadgeTiers = ['gold', 'diamond', 'aurora'] as const;
export type BadgeTier = typeof communityBadgeTiers[number];
export type BadgeFamilyId = 'attendance' | 'early' | 'writing' | 'appreciation' | 'answers' | 'featured';
export type BadgeFamily = {
  id: BadgeFamilyId; name: string; en: string; category: string; description: string; descriptionEn: string; unit: string; column: number;
  criteria: Record<BadgeTier, string>; criteriaEn: Record<BadgeTier, string>; note: string;
};
export const communityBadgeFamilies: readonly BadgeFamily[] = [
  { id: 'attendance', column: 0, name: '星轨同行', en: 'Shared orbit', category: '签到成就', description: '一次次到来，连成属于你的星轨。', descriptionEn: 'Each visit adds to your orbit.', unit: '天连续签到', criteria: { gold: '完成首次签到', diamond: '连续签到 100 天', aurora: '连续签到 365 天' }, criteriaEn: { gold: 'Complete a first check-in', diamond: 'Check in for 100 consecutive days', aurora: 'Check in for 365 consecutive days' }, note: '北京时间计日，沿用既有补签与连续签到规则。' },
  { id: 'early', column: 1, name: '晨光先至', en: 'First light', category: '签到成就', description: '比星光更早，迎接社区的新一天。', descriptionEn: 'Welcome a new day in the community.', unit: '天进入签到前十', criteria: { gold: '首次进入当天签到前 10', diamond: '累计 60 天，分布于至少 3 个自然月', aurora: '累计 180 天，分布于至少 12 个自然月' }, criteriaEn: { gold: 'A first top-ten daily check-in', diamond: '60 top-ten days across at least 3 calendar months', aurora: '180 top-ten days across at least 12 calendar months' }, note: '真实签到每个日期最多计一次；补签不参与前十。' },
  { id: 'writing', column: 2, name: '落笔成星', en: 'Words into stars', category: '内容创作', description: '从第一篇分享开始，让想法有了形状。', descriptionEn: 'Give your ideas a form through sharing.', unit: '篇有效主题', criteria: { gold: '首次发表通过审核的主题', diamond: '50 篇有效主题，其中至少 15 篇认可帖', aurora: '150 篇有效主题，其中至少 50 篇认可帖、3 篇精华；贡献分布于至少 12 个自然月' }, criteriaEn: { gold: 'Publish a first approved topic', diamond: '50 valid topics, including 15 recognized topics', aurora: '150 valid topics, 50 recognized topics and 3 featured topics across at least 12 calendar months' }, note: '认可帖须有至少 3 位独立用户有效点赞。' },
  { id: 'appreciation', column: 3, name: '星光共鸣', en: 'Starlight resonance', category: '内容认可', description: '你写下的内容，得到了更多人的认可。', descriptionEn: 'Your contributions resonate with others.', unit: '个有效收到的赞', criteria: { gold: '累计收到 10 个有效赞', diamond: '300 个有效赞，来自至少 100 位不同用户', aurora: '1,500 个有效赞，来自至少 300 位不同用户，覆盖至少 50 篇主题或回复；认可分布于至少 12 个自然月' }, criteriaEn: { gold: 'Receive 10 valid likes', diamond: '300 valid likes from at least 100 people', aurora: '1,500 valid likes from 300 people across 50 contributions and 12 calendar months' }, note: '同人同内容只计一个赞；撤赞再赞不增加累计，也不产生新的贡献月份。' },
  { id: 'answers', column: 4, name: '解惑之光', en: 'Guiding answers', category: '问答贡献', description: '给出有用的答案，让别人少走一段弯路。', descriptionEn: 'Help others find their way with useful answers.', unit: '次有效回答被采纳', criteria: { gold: '回答首次被采纳', diamond: '30 次有效采纳，来自至少 15 位不同提问者', aurora: '100 次有效采纳，来自至少 40 位不同提问者，分布于至少 12 个自然月' }, criteriaEn: { gold: 'A first accepted answer', diamond: '30 valid acceptances from at least 15 askers', aurora: '100 valid acceptances from 40 askers across at least 12 calendar months' }, note: '一个问题最多计一次；自采纳和经核实的串通采纳不计。' },
  { id: 'featured', column: 5, name: '璀璨之作', en: 'Lasting brilliance', category: '精选创作', description: '认真打磨的作品，成为社区里的长久星光。', descriptionEn: 'Thoughtful work becomes lasting starlight.', unit: '篇有效精华主题', criteria: { gold: '首次有主题被评为精华', diamond: '5 篇不同的有效精华主题', aurora: '20 篇不同的有效精华主题，分布于至少 12 个自然月' }, criteriaEn: { gold: 'A first featured topic', diamond: '5 different valid featured topics', aurora: '20 different valid featured topics across at least 12 calendar months' }, note: '同篇取消再评精华仍只计一篇，稳定期重新计算。' },
];
export const communityBadgeCommonRules = [
  '只展示每个系列实际已获的最高材质；旧版 12 枚荣誉保留为历史记录，不映射为新档位。',
  '炫彩要求注册满 365 天、最近 180 天无已确认违规；申诉撤销不计。非签到系列还须有 12 个实际贡献自然月。',
  '有效贡献须审核通过、普通社区成员可见、未删除、未隐藏；VIP 受限内容不计。高阶内容及认可记录须连续稳定至少 7 天。',
  '排除自赞、自采纳、经核实的作弊及无效来源；同 IP 不单独作为作弊证据。',
  '正常撤赞、删帖、取消采纳或精华、断签只更新未达成进度；已获荣誉保留达成时间。作弊、违规来源或误授经复核撤销。',
  '签到按北京时间和既有补签额度计算，补签无早鸟；VIP、星尘、装扮不改变门槛，徽章不奖励星尘或经验。',
] as const;
export const communityBadgeCommonRulesEn = [
  'Show only the highest actually earned material in each family. The twelve legacy honors remain historical records and never map to a new tier.',
  'Aurora requires an account age of 365 days and no confirmed violation in the last 180 days. Overturned decisions do not count. Content families also require contributions in 12 actual calendar months.',
  'Valid contributions must be approved, visible to ordinary community members, undeleted and unhidden. Restricted VIP content does not count. Higher content tiers require contributions and recognition to remain stable for at least 7 days.',
  'Exclude self likes, self acceptance, confirmed cheating and invalid sources. Sharing an IP address alone is not proof of cheating.',
  'Ordinary removal, unlike, cancellation or broken attendance changes unearned progress. Earned honors keep their achievement date; cheating, invalid sources and mistaken grants require a reviewed revocation.',
  'Check-ins use Beijing dates and the existing makeup allowance. Makeups never earn early ranks. VIP, stardust and decorations do not change thresholds; badges issue no stardust or experience.',
] as const;
export type BadgeMetrics = {
  accountDays: number; violations180: number;
  attendance: { checkins: number; streak: number };
  early: { days: number; months: number };
  writing: { topics: number; recognized: number; featured: number; months: number; stableTopics: number; stableRecognized: number; stableFeatured: number; stableMonths: number };
  appreciation: { likes: number; people: number; contents: number; months: number; stableLikes: number; stablePeople: number; stableContents: number; stableMonths: number };
  answers: { count: number; people: number; months: number; stableCount: number; stablePeople: number; stableMonths: number };
  featured: { count: number; months: number; stableCount: number; stableMonths: number };
};
export const emptyBadgeMetrics = (): BadgeMetrics => ({ accountDays: 0, violations180: 0, attendance: { checkins: 0, streak: 0 }, early: { days: 0, months: 0 }, writing: { topics: 0, recognized: 0, featured: 0, months: 0, stableTopics: 0, stableRecognized: 0, stableFeatured: 0, stableMonths: 0 }, appreciation: { likes: 0, people: 0, contents: 0, months: 0, stableLikes: 0, stablePeople: 0, stableContents: 0, stableMonths: 0 }, answers: { count: 0, people: 0, months: 0, stableCount: 0, stablePeople: 0, stableMonths: 0 }, featured: { count: 0, months: 0, stableCount: 0, stableMonths: 0 } });
export type BadgeAward = { family: BadgeFamilyId; tier: BadgeTier; achievedAt: string; revokedAt: string | null };
export type LegacyBadgeAward = { id: string; achievedAt: string; revokedAt: string | null };
export type BadgeRequirement = { key: string; label: string; labelEn: string; have: number; need: number; met: boolean };
export type BadgeTierState = { tier: BadgeTier; achieved: boolean; achievedAt: string | null; eligible: boolean; requirements: BadgeRequirement[]; blockedReasons: string[] };
export type BadgeFamilyState = { id: BadgeFamilyId; tier: BadgeTier | null; achievedAt: string | null; tiers: BadgeTierState[] };
export type CommunityBadgeState = { version: 1; families: BadgeFamilyState[]; legacy: LegacyBadgeAward[] };
export function legacyBadgeFamily(id: string): BadgeFamilyId | null {
  if (['first_checkin', 'streak7', 'streak30', 'streak100', 'streak365'].includes(id)) return 'attendance';
  if (id === 'early') return 'early';
  if (id === 'first_topic') return 'writing';
  if (['nice', 'good'].includes(id)) return 'appreciation';
  if (['accepted1', 'accepted10'].includes(id)) return 'answers';
  return id === 'featured' ? 'featured' : null;
}
export function evaluateCommunityBadges(metrics: BadgeMetrics, awards: readonly BadgeAward[] = [], legacy: readonly LegacyBadgeAward[] = []): CommunityBadgeState {
  const labels: Record<string, string> = { '连续签到': 'Consecutive check-in days', '签到天数': 'Check-in days', '早鸟天数': 'Top-ten check-in days', '实际早鸟自然月': 'Actual top-ten calendar months', '稳定有效主题': 'Stable valid topics', '有效主题': 'Valid topics', '稳定认可帖': 'Stable recognized topics', '稳定精华主题': 'Stable featured topics', '实际贡献自然月': 'Actual contribution calendar months', '稳定有效获赞': 'Stable valid likes', '有效获赞': 'Valid likes', '独立点赞用户': 'Distinct people liking your work', '获赞内容篇数': 'Different liked contributions', '实际认可自然月': 'Actual recognition calendar months', '稳定有效采纳': 'Stable valid acceptances', '有效采纳': 'Valid acceptances', '独立提问者': 'Distinct askers', '实际采纳自然月': 'Actual acceptance calendar months', '稳定有效精华': 'Stable valid featured topics', '有效精华': 'Valid featured topics', '实际精华自然月': 'Actual featured calendar months', '账号注册天数': 'Days since account registration', '最近 180 天无已确认违规': 'No confirmed violation in the past 180 days' };
  const requirement = (key: string, label: string, have: number, need: number): BadgeRequirement => ({ key, label, labelEn: labels[label] || label, have, need, met: have >= need });
  const families = communityBadgeFamilies.map(family => {
    const tiers = communityBadgeTiers.map((tier, rank): BadgeTierState => {
      const stable = rank > 0, aurora = rank === 2, requirements: BadgeRequirement[] = [];
      const add = (key: string, label: string, have: number, need: number) => requirements.push(requirement(key, label, have, need));
      if (family.id === 'attendance') add(rank ? 'streak' : 'checkins', rank ? '连续签到' : '签到天数', rank ? metrics.attendance.streak : metrics.attendance.checkins, [1, 100, 365][rank]);
      if (family.id === 'early') { add('earlyDays', '早鸟天数', metrics.early.days, [1, 60, 180][rank]); if (rank) add('earlyMonths', '实际早鸟自然月', metrics.early.months, aurora ? 12 : 3); }
      if (family.id === 'writing') { const m = metrics.writing; add('topics', stable ? '稳定有效主题' : '有效主题', stable ? m.stableTopics : m.topics, [1, 50, 150][rank]); if (rank) add('recognized', '稳定认可帖', m.stableRecognized, aurora ? 50 : 15); if (aurora) { add('featured', '稳定精华主题', m.stableFeatured, 3); add('months', '实际贡献自然月', m.stableMonths, 12); } }
      if (family.id === 'appreciation') { const m = metrics.appreciation; add('likes', stable ? '稳定有效获赞' : '有效获赞', stable ? m.stableLikes : m.likes, [10, 300, 1500][rank]); if (rank) add('people', '独立点赞用户', m.stablePeople, aurora ? 300 : 100); if (aurora) { add('contents', '获赞内容篇数', m.stableContents, 50); add('months', '实际认可自然月', m.stableMonths, 12); } }
      if (family.id === 'answers') { const m = metrics.answers; add('accepted', stable ? '稳定有效采纳' : '有效采纳', stable ? m.stableCount : m.count, [1, 30, 100][rank]); if (rank) add('people', '独立提问者', m.stablePeople, aurora ? 40 : 15); if (aurora) add('months', '实际采纳自然月', m.stableMonths, 12); }
      if (family.id === 'featured') { const m = metrics.featured; add('featured', stable ? '稳定有效精华' : '有效精华', stable ? m.stableCount : m.count, [1, 5, 20][rank]); if (aurora) add('months', '实际精华自然月', m.stableMonths, 12); }
      if (aurora) { add('accountDays', '账号注册天数', metrics.accountDays, 365); add('clean180', '最近 180 天无已确认违规', metrics.violations180 === 0 ? 1 : 0, 1); }
      const award = awards.find(item => item.family === family.id && item.tier === tier);
      const blockedReasons = requirements.filter(item => !item.met).map(item => `${item.label}：${item.have}/${item.need}`);
      if (award?.revokedAt) blockedReasons.push('该档荣誉已经复核撤销，须由管理者复核后恢复。');
      return { tier, achieved: Boolean(award && !award.revokedAt), achievedAt: award && !award.revokedAt ? award.achievedAt : null, eligible: requirements.every(item => item.met) && !award?.revokedAt, requirements, blockedReasons };
    });
    const highest = [...tiers].reverse().find(item => item.achieved);
    return { id: family.id, tier: highest?.tier ?? null, achievedAt: highest?.achievedAt ?? null, tiers };
  });
  return { version: 1, families, legacy: [...legacy] };
}
