import type { Common, CommunityMe } from './community.ts';
import type { CommunityConvention, CommunityConventionRead } from './community-convention.ts';

type Options = {
  request: <T>(path: string) => Promise<T>;
  send: <T>(path: string, body: object) => Promise<T>;
  renderBody: (body: string, common: Common) => string;
  accepted: (version: string) => void;
  now?: () => number;
};

export function createCommunityConventionConsent({ request, send, renderBody, accepted, now = () => performance.now() }: Options) {
  let key = '';
  let generation = 0;
  let layer: HTMLElement | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let document: Document | null = null;
  let common: Common | null = null;
  let previousFocus: HTMLElement | null = null;
  let overflow = '';
  let elapsedAt = Infinity;
  let version = '';
  let saving = false;
  const background = new Map<HTMLElement, boolean>();
  function lockBackground(host: Document, overlay: HTMLElement) {
    for (const node of Array.from(host.body.children)) {
      if (node === overlay || node.matches('script, style, link')) continue;
      const element = node as HTMLElement;
      if (!background.has(element)) background.set(element, element.inert);
      element.inert = true;
    }
    overlay.inert = false;
  }

  const tick = () => {
    if (!layer || !common) return;
    const button = layer.querySelector<HTMLButtonElement>('[data-convention-confirm]');
    const remaining = Math.max(0, Math.ceil((elapsedAt - now()) / 1000));
    if (!button) return;
    button.disabled = saving || remaining > 0;
    button.textContent = saving ? common.t('正在确认…', 'Confirming…') : remaining > 0 && Number.isFinite(remaining)
      ? common.t(`请阅读 · ${remaining} 秒后可确认`, `Read first · confirm in ${remaining}s`)
      : remaining === 0 ? common.t('我已阅读并同意公约与社区规则', 'I have read and agree to the convention and community rules') : common.t('正在读取…', 'Loading…');
  };
  const onKey = (event: KeyboardEvent) => {
    if (!layer) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(layer.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]'));
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    const active = document?.activeElement;
    if (!layer.contains(active || null) || event.shiftKey && active === first || !event.shiftKey && active === last) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus({ preventScroll: true });
    }
  };
  function close() {
    generation++;
    key = ''; version = ''; elapsedAt = Infinity; saving = false;
    if (timer) clearInterval(timer); timer = undefined;
    layer?.remove(); layer = null;
    for (const [node, inert] of background) node.inert = inert;
    background.clear();
    if (document) { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey, true); }
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    previousFocus = null; document = null; common = null;
  }
  const status = (text: string) => { const node = layer?.querySelector('[data-convention-status]'); if (node) node.textContent = text; };
  async function read(token: number) {
    if (!layer || !common) return;
    const body = layer.querySelector<HTMLElement>('[data-convention-body]')!;
    const retry = layer.querySelector<HTMLButtonElement>('[data-convention-retry]')!;
    retry.hidden = true; elapsedAt = Infinity; tick(); status('');
    try {
      const current = await request<CommunityConvention>('convention');
      if (token !== generation || !common) return;
      version = current.version;
      body.innerHTML = renderBody(current.body, common);
      const reading = await send<CommunityConventionRead>('convention/read', { version });
      if (token !== generation || reading.version !== version) return;
      if (!Number.isFinite(Date.parse(reading.eligibleAt))) throw new Error(common.t('阅读时间读取失败，请重试。', 'Could not start the reading timer. Retry.'));
      // A monotonic local ten seconds also prevents clock skew from unlocking
      // the button early. The server independently enforces its own deadline.
      elapsedAt = now() + 10000;
      if (timer) clearInterval(timer);
      timer = setInterval(tick, 200); tick();
    } catch (error) {
      if (token !== generation || !common) return;
      status(error instanceof Error ? error.message : common.t('公约读取失败，请重试。', 'Could not load the convention. Retry.'));
      retry.hidden = false;
    }
  }
  async function confirm() {
    if (!common || saving || now() < elapsedAt || !version) return;
    saving = true; tick(); status('');
    const token = generation;
    try {
      const result = await send<{ agreed: true; version: string }>('agree', { version });
      if (token !== generation) return;
      close(); accepted(result.version);
    } catch (error) {
      if (token !== generation || !common) return;
      saving = false;
      if ((error as { status?: number }).status === 409) { await read(token); return; }
      status(error instanceof Error ? error.message : common.t('确认失败，请重试。', 'Confirmation failed. Retry.')); tick();
    }
  }
  return {
    sync(me: CommunityMe | null, host: Document, context: Common) {
      if (!me?.convention || me.convention.agreed) { if (layer) close(); return; }
      const next = `${me.role}:${me.uid}:${me.convention.version}`;
      if (next === key && layer) { lockBackground(host, layer); return; }
      if (layer) close();
      key = next; document = host; common = context;
      previousFocus = host.activeElement as HTMLElement | null;
      overflow = host.body.style.overflow;
      layer = host.createElement('div'); layer.className = 'community-convention-dialog';
      layer.innerHTML = `<section class="community-convention-window" role="dialog" aria-modal="true" aria-labelledby="community-convention-title"><header><h2 id="community-convention-title" tabindex="-1">${context.t('社区公约', 'Community convention')}</h2><p>${context.t('请阅读至少 10 秒。确认后代表同意遵守本公约及社区规则。', 'Read for at least 10 seconds. Confirmation means agreeing to follow the convention and community rules.')}</p></header><div class="community-convention-reading" data-convention-body tabindex="0" role="region" aria-label="${context.t('公约正文', 'Convention terms')}"></div><footer><p role="status" aria-live="polite" data-convention-status></p><button type="button" class="community-button" data-convention-retry hidden>${context.t('重新读取', 'Retry')}</button><button type="button" class="community-button is-gold" data-convention-confirm disabled></button></footer></section>`;
      lockBackground(host, layer);
      host.body.append(layer); host.body.style.overflow = 'hidden'; host.addEventListener('keydown', onKey, true);
      layer.querySelector('[data-convention-confirm]')?.addEventListener('click', () => { void confirm(); });
      layer.querySelector('[data-convention-retry]')?.addEventListener('click', () => { void read(generation); });
      layer.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
      tick(); void read(generation);
    },
    close,
  };
}
