import type { IncomingMessage } from 'node:http';
import type { CommunityService } from '../../server/community-service.ts';

// Mounted only by catalog-fixture-preview.mjs, never by the publishing runtime.
// Reuses the sample-account cookie already understood by community-demo.mjs.
export const previewIdentityPath = '/api/community/preview-identity';
const roles = [
  { id: 'demo', label: '读者', name: '预览读者', detail: '浏览、发帖、回复、签到、兑换；没有社区管理权限。' },
  { id: 'owner', label: '作者 / 站长', name: '無相', detail: '审核、举报、处罚、任命协管，以及兑换物品上架和发货。' },
  { id: 'steward', label: '版主 / 协管', name: '守望', detail: '样例负责学习问答、工具资源，可在这些板块审核和处理举报；可执行全社区禁言，不能上架、发货或任命其他版主。' },
] as const;
const themeOf = (value: string | null) => value === 'light' ? 'light' : 'dark';
const roleOf = (req: IncomingMessage) => roles.find(role => role.id === /(?:^|;\s*)preview_as=([a-z]+)(?:;|$)/.exec(req.headers.cookie || '')?.[1]) || roles[0];
const communityHref = (theme: string) => `/?communityTheme=${theme}#/community/home`;

function pickerHTML(req: IncomingMessage, theme: string) {
  const current = roleOf(req);
  return `<!doctype html><html lang="zh-CN" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地身份预览 · 社区</title>
<style>
:root{color-scheme:light;--bg:#e8e2d5;--surface:#f4efe5;--text:#34445a;--muted:#56647a;--gold:#775c35;--line:#baa88d;--button:#e4d2ad}
[data-theme=dark]{color-scheme:dark;--bg:#172334;--surface:#1e2e43;--text:#ede7db;--muted:#b1bdce;--gold:#dcc69a;--line:#675f53;--button:#ddc69b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:800px;margin:48px auto;padding:0 24px}h1{font:600 30px/1.3 Georgia,"Songti SC",serif;margin:12px 0;color:var(--gold)}p{margin:10px 0;color:var(--muted)}.eyebrow{font-size:14px;color:var(--gold)}.roles{margin:28px 0;border-top:1px solid var(--line)}form{display:flex;gap:24px;align-items:center;padding:24px 0;border-bottom:1px solid var(--line)}.role{flex:1}.role strong{font-size:19px}.role p{margin:6px 0 0}.current{display:inline-block;color:var(--gold);font-size:13px;margin-left:10px}button{font-family:inherit;font-size:15px;font-weight:600;line-height:1.4;flex:none;padding:11px 18px;border:1px solid var(--gold);border-radius:8px;background:var(--button);color:#443720;cursor:pointer}button:hover{filter:brightness(1.06)}button:active{transform:translateY(1px)}button:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:4px}a{color:var(--gold);text-underline-offset:4px}.links{display:flex;flex-wrap:wrap;gap:20px;margin:24px 0}.note{font-size:14px;padding:16px;background:var(--surface);border-left:2px solid var(--line)}@media(max-width:560px){main{margin:28px auto}form{align-items:flex-start;flex-direction:column;gap:12px;padding:20px 0}}
</style></head><body><main><div class="eyebrow">社区 · 本地模拟数据</div><h1>本地身份预览</h1><p>当前身份：<strong>${current.name}（${current.label}）</strong>。选择样例账号后返回社区；作者和版主可从账号菜单进入管理台。</p><div class="roles">
${roles.map(role => `<form method="post" action="${previewIdentityPath}"><input type="hidden" name="role" value="${role.id}"><input type="hidden" name="theme" value="${theme}"><div class="role"><strong>${role.label} · ${role.name}</strong>${current.id === role.id ? '<span class="current">当前身份</span>' : ''}<p>${role.detail}</p></div><button type="submit">切换并打开</button></form>`).join('')}
</div><div class="links"><a href="${communityHref(theme)}">返回当前身份的社区</a><a href="${previewIdentityPath}?theme=${theme === 'light' ? 'dark' : 'light'}">${theme === 'light' ? '深色' : '明亮'}预览</a></div><p class="note">仅供开发测试手动选择本机样例账号，不会登录真实作者账号。这里的操作只影响临时模拟数据。社区用户菜单不展示此入口，正式网站不会启用此入口。<br>同一浏览器的标签页共享身份；切换后，其他已打开的社区标签页请刷新，以免显示旧身份。</p></main></body></html>`;
}

export function createCommunityPreviewService(service: Pick<CommunityService, 'handle'>, port: number): Pick<CommunityService, 'handle'> {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return {
    async handle(req, res) {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      const local = hosts.has(req.headers.host || '') && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
      if (url.pathname !== previewIdentityPath) return service.handle(req, res);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      const reply = (status: number, message: string) => {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(message);
      };
      if (!local) {
        reply(403, '身份预览仅供本机使用。'); return;
      }
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pickerHTML(req, themeOf(url.searchParams.get('theme')))); return;
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); reply(405, '请求方式无效。'); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { reply(403, '请从本地身份预览页切换。'); return; }
      if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/x-www-form-urlencoded') { reply(415, '请使用身份预览表单。'); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        bytes += buffer.length;
        if (bytes > 2048) { req.resume(); reply(413, '请求内容过长。'); return; }
        chunks.push(buffer);
      }
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const role = roles.find(role => role.id === form.get('role'));
      if (!role) { reply(400, '请选择读者、作者或版主。'); return; }
      res.writeHead(303, {
        'Set-Cookie': [`preview_as=${role.id}; Path=/; HttpOnly; SameSite=Strict`, 'community_browse=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'],
        Location: communityHref(themeOf(form.get('theme'))),
      });
      res.end();
    },
  };
}
