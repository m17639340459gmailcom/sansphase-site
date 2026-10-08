export type CommunityBoardIcon = {
  readonly id: string; readonly zh: string; readonly en: string;
  readonly color: string; readonly lightColor: string;
};

// Keep metadata independent of the drawing library so server validation and
// both browser bundles share exactly the same names and theme colors.
const choices = [
  { id: 'help', zh: '问号', en: 'Question', color: '#9fb8e0', lightColor: '#41658f' },
  { id: 'image', zh: '图片', en: 'Image', color: '#e7a9c6', lightColor: '#875073' },
  { id: 'box', zh: '方盒', en: 'Box', color: '#8fd0c8', lightColor: '#2c6d65' },
  { id: 'feather', zh: '羽毛', en: 'Feather', color: '#d9c49c', lightColor: '#775e31' },
  { id: 'megaphone', zh: '喇叭', en: 'Megaphone', color: '#788392', lightColor: '#52637b' },
  { id: 'coffee', zh: '茶杯', en: 'Cup', color: '#c9b6f2', lightColor: '#6f5191' },
  { id: 'bot', zh: '智能体', en: 'AI agents', color: '#8fd0c8', lightColor: '#2c6d65' },
  { id: 'brain', zh: 'AI 咨询', en: 'AI advice', color: '#c9b6f2', lightColor: '#6f5191' },
  { id: 'cpu', zh: '模型芯片', en: 'Models and chips', color: '#9fb8e0', lightColor: '#41658f' },
  { id: 'workflow', zh: '工作流', en: 'Workflows', color: '#8fd0c8', lightColor: '#2c6d65' },
  { id: 'code', zh: '编程代码', en: 'Programming', color: '#9fb8e0', lightColor: '#41658f' },
  { id: 'lightbulb', zh: '灵感', en: 'Ideas', color: '#d9c49c', lightColor: '#775e31' },
  { id: 'book-open', zh: '教程学习', en: 'Tutorials', color: '#d9c49c', lightColor: '#775e31' },
  { id: 'flask', zh: '实验测试', en: 'Experiments', color: '#c9b6f2', lightColor: '#6f5191' },
  { id: 'database', zh: '数据资料', en: 'Data', color: '#8fd0c8', lightColor: '#2c6d65' },
  { id: 'mic', zh: '语音音频', en: 'Voice and audio', color: '#e7a9c6', lightColor: '#875073' },
  { id: 'video', zh: '视频创作', en: 'Video creation', color: '#9fb8e0', lightColor: '#41658f' },
  { id: 'palette', zh: '视觉设计', en: 'Visual design', color: '#e7a9c6', lightColor: '#875073' },
  { id: 'network', zh: '连接网络', en: 'Networks', color: '#8fd0c8', lightColor: '#2c6d65' },
  { id: 'compass', zh: '探索发现', en: 'Exploration', color: '#d9c49c', lightColor: '#775e31' },
  { id: 'wand', zh: '创作魔法', en: 'Creative magic', color: '#c9b6f2', lightColor: '#6f5191' },
  { id: 'wrench', zh: '工具开发', en: 'Tool development', color: '#788392', lightColor: '#52637b' },
] as const satisfies readonly CommunityBoardIcon[];

export type CommunityBoardIconId = typeof choices[number]['id'];
export const communityBoardIconChoices: readonly CommunityBoardIcon[] = Object.freeze(choices.map(choice => Object.freeze(choice)));
const byId = new Map<string, CommunityBoardIcon>(communityBoardIconChoices.map(choice => [choice.id, choice]));

export function communityBoardIcon(value: unknown): CommunityBoardIcon | undefined {
  return typeof value === 'string' ? byId.get(value) : undefined;
}

export function availableCommunityBoardIcons(items: readonly { icon: string }[]): CommunityBoardIcon[] {
  const used = new Set(items.map(item => item.icon));
  return communityBoardIconChoices.filter(choice => !used.has(choice.id));
}
