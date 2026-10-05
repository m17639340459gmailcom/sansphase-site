// Textarea fallback and auxiliary fields share the same auto-growing behavior.
// Rich body editors grow naturally through document layout.
export function autosizeCommunityTextarea(field: HTMLTextAreaElement): void {
  if (field.hidden) return;
  const style = field.ownerDocument.defaultView!.getComputedStyle(field);
  const minimum = Number.parseFloat(style.minHeight) || 0;
  const border = style.boxSizing === 'border-box'
    ? (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0) : 0;
  const padding = style.boxSizing === 'content-box'
    ? (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0) : 0;
  field.style.height = '0px';
  field.style.height = `${Math.max(minimum, field.scrollHeight + border - padding)}px`;
}
