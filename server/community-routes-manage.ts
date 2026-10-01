import { communityBoards } from '../src/community.mjs';
import { communityReviewReasons } from '../src/community-rules.mjs';
import { fail, memberKey } from './community-db.ts';
import type { CommunityAuthor } from './community-db.ts';
import type { Body, Ctx } from './community-context.ts';
import type { CustomItemInput } from './community-economy.ts';

const tabs = ['queue', 'reports', 'orders', 'items', 'sanctions', 'data'] as const;
// The owner manages the shop and orders; stewards help with the queue, reports and sanctions.
const ownerTabs = new Set(['orders', 'items']);
const whole = (value: unknown, label: string, min: number, max: number) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw fail(`${label}需要是 ${min} 到 ${max} 之间的整数。`);
  return number;
};
function itemInput(ctx: Ctx, body: Body): CustomItemInput {
  const cat = body.cat === 'goods' ? 'goods' : body.cat === 'digital' ? 'digital' : null;
  if (!cat) throw fail('请选择物品类别。');
  const limitPer = body.limitPer === 'month' || body.limitPer === 'year' || body.limitPer === 'once' ? body.limitPer : null;
  const stock = body.stock === null || body.stock === '' || body.stock === undefined ? null : whole(body.stock, '库存', 0, 100000);
  if (cat === 'goods' && stock === null) throw fail('实物需要填写库存。');
  const delivery = typeof body.delivery === 'string' ? body.delivery.replace(/\r\n?/g, '\n').trim() : '';
  if (cat === 'digital' && !delivery) throw fail('数字资源需要填写兑换后给出的内容，比如下载链接和提取码。');
  if ([...delivery].length > 2000) throw fail('兑换后给出的内容最多 2000 个字。');
  return {
    cat, name: ctx.clean(body.name, [2, 30], '名称', false), description: ctx.clean(body.description, [4, 200], '说明', true),
    price: whole(body.price, '价格', 1, 100000), stock, limitPer, limitN: limitPer ? whole(body.limitN || 1, '限兑次数', 1, 100) : null,
    minLevel: whole(body.minLevel || 0, '最低等级', 0, 3), minDays: whole(body.minDays || 0, '注册天数', 0, 3650),
    delivery, note: typeof body.note === 'string' ? ctx.clean(body.note || ' ', [0, 60], '备注', false) : '', active: body.active !== false,
  };
}

export async function manageRoutes(ctx: Ctx): Promise<boolean> {
  const { live, path, method, url } = ctx;
  if (!path.startsWith('manage')) return false;
  if (!ctx.mod) throw fail('只有站长和协管能进入社区管理。', 403);
  if (method === 'GET' && path === 'manage') {
    const tab = (tabs as readonly string[]).includes(url.searchParams.get('tab') || '') ? url.searchParams.get('tab')! : 'queue';
    if (ownerTabs.has(tab) && !ctx.owner) throw fail('只有站长能管理兑换所。', 403);
    const queue = live.queue();
    const reports = live.openReports();
    const orders = ctx.owner ? live.economy.goodsOrders() : [];
    const sanctions = live.members.sanctions();
    const people: CommunityAuthor[] = [
      ...queue.topics.map(topic => topic.author), ...queue.replies.map(reply => reply.author),
      ...reports.map(report => report.reporter), ...orders.map(order => order.member), ...sanctions.map(sanction => sanction.member),
    ];
    const reportTargets = reports.map(report => {
      const reply = report.target.kind === 'reply' ? live.reply(report.target.id) : null;
      const topic = live.topic(reply ? reply.topicId : report.target.id);
      if (reply) people.push(reply.author); else if (topic) people.push(topic.author);
      return { report, reply, topic };
    });
    const map = await ctx.people(people);
    const activity = live.activity();
    ctx.send({
      tab, owner: ctx.owner,
      counts: { queue: queue.topics.length + queue.replies.length, reports: reports.length, orders: orders.filter(order => order.status === 'pending').length, sanctions: sanctions.length },
      kpis: { topics24h: activity.topics24h, replies24h: activity.replies24h },
      queue: {
        topics: queue.topics.map(topic => ({ ...ctx.topicDTO(topic, map), body: [...topic.body].slice(0, 200).join(''), pendingReason: topic.pendingReason, hiddenReason: topic.hiddenReason })),
        replies: queue.replies.map(reply => ({ ...reply, author: ctx.person(reply.author, map), body: [...reply.body].slice(0, 200).join('') })),
      },
      reports: reportTargets.map(({ report, reply, topic }) => ({
        id: report.id, reason: report.reason, note: report.note, createdAt: report.createdAt, reporter: ctx.person(report.reporter, map),
        target: {
          kind: report.target.kind, topicId: topic?.id || null, title: topic?.title || '（已删除）',
          excerpt: [...(reply ? reply.body : topic?.body || '')].slice(0, 140).join(''),
          author: reply ? ctx.person(reply.author, map) : topic ? ctx.person(topic.author, map) : null,
          gone: (report.target.kind === 'reply' && !reply) || !topic, hidden: reply ? reply.hidden : Boolean(topic?.hidden),
        },
      })),
      orders: orders.map(order => ({ ...order, member: ctx.person(order.member, map) })),
      items: ctx.owner ? live.economy.customItems() : [],
      sanctions: sanctions.map(sanction => ({ ...sanction, member: ctx.person(sanction.member, map) })),
      data: tab === 'data' ? { flow: live.ledger.flow(7), boards: communityBoards.map(board => ({ id: board.id, topics: activity.boards[board.id] || 0 })) } : null,
    });
    return true;
  }
  if (method !== 'POST') return false;
  const body = await ctx.json();
  const report = /^manage\/reports\/([^/]+)$/.exec(path);
  if (report) {
    const result = live.resolveReport(report[1], body.uphold === true);
    await ctx.audit(body.uphold === true ? 'report-upheld' : 'report-dismissed', { report: report[1] });
    ctx.send(result);
    return true;
  }
  const lift = /^manage\/sanctions\/([^/]+)\/lift$/.exec(path);
  if (lift) {
    const member = live.members.lift(lift[1]);
    if (!member) throw fail('这条禁言已经结束了。', 409);
    await ctx.audit('lift', { sanction: lift[1], member: memberKey(member) });
    ctx.send({ ok: true });
    return true;
  }
  const reject = /^manage\/topics\/([^/]+)\/reject$/.exec(path);
  if (reject) {
    if (!ctx.mod) throw fail('只有站长和协管能审核帖子。', 403);
    const reason = String(body.reason || '');
    if (!(communityReviewReasons as readonly string[]).includes(reason)) throw fail('请选择审核不通过的理由。');
    const note = typeof body.note === 'string' && body.note.trim() ? ctx.clean(body.note, [1, 200], '补充说明', false) : '';
    const result = live.rejectTopic(reject[1], reason, note);
    await ctx.audit('reject-topic', { topic: reject[1], reason, note });
    ctx.send({ ok: true, ...result });
    return true;
  }
  if (!ctx.owner) throw fail('只有站长能管理兑换所。', 403);
  const order = /^manage\/orders\/([^/]+)\/(ship|cancel)$/.exec(path);
  if (order) {
    let tracking = null;
    if (order[2] === 'ship') {
      const company = typeof body.company === 'string' ? body.company.trim() : '';
      const number = typeof body.tracking === 'string' ? body.tracking.trim() : '';
      if (company.length > 40 || number.length > 80 || /[\u0000-\u001f<>]/.test(company + number)) throw fail('快递信息格式无效。');
      tracking = company || number ? { company, number } : null;
    }
    const result = order[2] === 'ship' ? live.economy.ship(order[1], Date.now(), tracking) : live.economy.cancel(order[1]);
    live.members.notify(result.member, { type: 'system', text: order[2] === 'ship' ? '你兑换的物品已经发货' : '你兑换的物品已取消，星尘已退回', data: { order: order[2] === 'ship' ? 'shipped' : 'cancelled', item: result.itemName, amount: result.price, ...(result.tracking?.number ? { tracking: result.tracking.number, company: result.tracking.company } : {}) } });
    await ctx.audit(`order-${order[2]}`, { order: order[1], item: result.item });
    ctx.send({ ok: true });
    return true;
  }
  const item = /^manage\/items(?:\/([^/]+))?$/.exec(path);
  if (item) {
    const id = live.economy.saveItem(item[1] || null, itemInput(ctx, body));
    await ctx.audit(item[1] ? 'item-update' : 'item-create', { item: id });
    ctx.send({ id }, item[1] ? 200 : 201);
    return true;
  }
  return false;
}
