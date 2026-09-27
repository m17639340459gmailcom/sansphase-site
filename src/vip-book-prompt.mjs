export const vipContactURL = 'https://qm.qq.com/q/l4344ltsBi';

export function vipBookGate(english = false) {
  return `<section class="page vip-book-gate"><div class="vip-book-gate-card"><span class="catalog-vip-badge">VIP</span><h1>${english ? 'VIP reading' : '仅限 VIP 阅读'}</h1><p>${english ? 'Contact the author to activate VIP before reading this book.' : '这本书需要 VIP 权限。联系作者开通后即可阅读。'}</p><button type="button" class="button" data-action="open-vip-prompt">${english ? 'Activate VIP' : '开通 VIP'}</button><a class="text-link" href="#/resource-center">${english ? 'Back to books' : '返回资源中心'}</a></div></section>`;
}

export function mountVipBookPrompt({ english = false } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'vip-book-dialog';
  dialog.setAttribute('aria-labelledby', 'vip-book-dialog-title');
  dialog.innerHTML = `<div class="vip-book-dialog-content"><span class="catalog-vip-badge">VIP</span><button type="button" class="vip-book-close" data-vip-close aria-label="${english ? 'Close' : '关闭'}">×</button><h2 id="vip-book-dialog-title">${english ? 'VIP reading' : '仅限 VIP 阅读'}</h2><p>${english ? 'Contact the author to activate VIP and read this book.' : '这本书仅对 VIP 开放。联系作者开通后，即可阅读完整章节与插图。'}</p><div class="vip-book-dialog-actions"><button type="button" data-vip-close>${english ? 'Maybe later' : '暂不开通'}</button><a class="button" href="${vipContactURL}" rel="noopener noreferrer">${english ? 'Activate VIP' : '开通 VIP'}</a></div></div>`;
  document.body.append(dialog);
  dialog.addEventListener('click', event => {
    if(event.target === dialog || event.target.closest('[data-vip-close]')) dialog.close();
  });
  return {
    open() { if(!dialog.open) dialog.showModal(); },
    updateLanguage(nextEnglish) { if(nextEnglish !== english) { dialog.remove(); return mountVipBookPrompt({english:nextEnglish}); } return this; },
    destroy() { dialog.remove(); },
  };
}
