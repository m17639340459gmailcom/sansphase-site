// Keep the editing caret below the sticky controls, including when the font
// options wrap on a phone or change height after expanding.
export function mountEditorToolbar(toolbar, editor) {
  const panel = toolbar.closest('.author-panel');
  const body = toolbar.nextElementSibling;
  const win = toolbar.ownerDocument.defaultView;
  let frame;
  // The toolbar must show the glass backdrop, not scrolling lines of text.
  // Clip only the body portion covered by the sticky controls.
  const clipBody = () => {
    const overlap = Math.max(0, toolbar.getBoundingClientRect().bottom - body.getBoundingClientRect().top);
    body.style.setProperty('--editor-clip-top', `${Math.ceil(overlap)}px`);
  };
  const scheduleClip = () => {
    if (frame === undefined) frame = win.requestAnimationFrame(() => { frame = undefined; clipBody(); });
  };
  const measure = () => {
    const height = toolbar.getBoundingClientRect().height;
    if (!height || editor.isDestroyed) return;
    const margin = {top: Math.ceil(height) + 16, bottom: 24, left: 0, right: 0};
    panel.style.setProperty('--editor-tools-height', `${margin.top}px`);
    editor.view.setProps({scrollMargin: margin, scrollThreshold: margin});
    clipBody();
  };
  const Observer = toolbar.ownerDocument.defaultView.ResizeObserver;
  const observer = Observer ? new Observer(measure) : null;
  observer?.observe(toolbar);
  observer?.observe(body);
  panel.addEventListener('scroll', scheduleClip, {passive:true});
  measure();
  return () => {
    observer?.disconnect(); panel.removeEventListener('scroll', scheduleClip);
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    panel.style.removeProperty('--editor-tools-height'); body.style.removeProperty('--editor-clip-top');
  };
}
