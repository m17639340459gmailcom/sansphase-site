import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import * as Select from '@radix-ui/react-select';

type CommunitySelect = { update(): void; dispose(): void };
type Choice = { value: string; label: string; disabled: boolean };
type ChoiceGroup = { label: string; choices: Choice[] };
type ChoiceRow = Choice | ChoiceGroup;
type View = { rows: ChoiceRow[]; value: string; label: string; disabled: boolean; required: boolean; invalid: boolean | 'grammar' | 'spelling' | undefined; ariaLabel?: string; labelledBy?: string; describedBy?: string; title?: string };

const mounted = new WeakMap<HTMLSelectElement, CommunitySelect>();
let nextId = 0;
const encoded = (index: number) => index >= 0 ? `option-${index}` : '';
const optionDisabled = (option: HTMLOptionElement) => option.disabled || (option.parentElement?.tagName === 'OPTGROUP' && (option.parentElement as HTMLOptGroupElement).disabled);

function snapshot(select: HTMLSelectElement): View {
  const options = Array.from(select.options);
  const choice = (option: HTMLOptionElement): Choice => ({ value: encoded(options.indexOf(option)), label: option.label, disabled: optionDisabled(option) });
  const rows: ChoiceRow[] = [];
  for (const child of Array.from(select.children)) {
    if (child.tagName === 'OPTION' && !(child as HTMLOptionElement).hidden) rows.push(choice(child as HTMLOptionElement));
    else if (child.tagName === 'OPTGROUP' && !(child as HTMLOptGroupElement).hidden) {
      const group = child as HTMLOptGroupElement;
      rows.push({ label: group.label, choices: Array.from(group.children).filter(option => option.tagName === 'OPTION' && !(option as HTMLOptionElement).hidden).map(option => choice(option as HTMLOptionElement)) });
    }
  }
  const nativeInvalid = select.getAttribute('aria-invalid');
  const invalid = nativeInvalid === null ? undefined : nativeInvalid === 'false' ? false : nativeInvalid === 'grammar' || nativeInvalid === 'spelling' ? nativeInvalid : true;
  return { rows, value: encoded(select.selectedIndex), label: options[select.selectedIndex]?.label ?? '', disabled: select.matches(':disabled'), required: select.required, invalid, ariaLabel: select.getAttribute('aria-label') || undefined, labelledBy: select.getAttribute('aria-labelledby') || undefined, describedBy: select.getAttribute('aria-describedby') || undefined, title: select.title || undefined };
}

/** Keep the native select as the sole named form control; enhance its presentation. */
export function mountCommunitySelect(select: HTMLSelectElement, icons: Record<string, string>): CommunitySelect {
  const prior = mounted.get(select);
  if (prior) return prior;
  if (select.multiple) throw new Error('社区下拉增强仅支持单选字段。');
  const doc = select.ownerDocument, win = doc.defaultView;
  if (!win || !select.parentNode) throw new Error('社区下拉字段必须连接到页面。');

  const triggerBase = select.id ? `${select.id}-trigger` : `community-select-${++nextId}`;
  let triggerId = triggerBase, suffix = 0;
  while (doc.getElementById(triggerId)) triggerId = `${triggerBase}-${++suffix}`;
  const host = doc.createElement('span');
  host.className = 'community-select-host';
  select.after(host);
  const wasHidden = select.hidden;
  const nativeMarker = select.getAttribute('data-community-select-native');
  const labels = Array.from(select.labels ?? []).map((label, index) => {
    const before = { label, for: label.getAttribute('for'), id: label.getAttribute('id') };
    label.htmlFor = triggerId;
    if (!label.id) label.id = `${triggerId}-label-${index}`;
    return before;
  });
  select.hidden = true;
  select.setAttribute('data-community-select-native', '');

  let disposed = false, resetPending = false;
  let trigger: HTMLButtonElement | null = null;
  const root = createRoot(host);
  // Radix emits changes from its unnamed mirror. Only the original field may
  // reach the page's existing form controller.
  const presentationChange = (event: Event) => event.stopPropagation();
  host.addEventListener('change', presentationChange);
  const setTrigger = (node: HTMLButtonElement | null) => { trigger = node; };
  // Icon markup comes only from the caller's built-in icon library, never option data.
  const icon = (name: string) => <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] ?? '' }} />;

  const choose = (value: string) => {
    if (disposed || resetPending || select.matches(':disabled')) return;
    const index = /^option-(\d+)$/.exec(value)?.[1];
    const option = index === undefined ? null : select.options[Number(index)];
    if (!option || optionDisabled(option) || select.selectedIndex === Number(index)) return;
    select.selectedIndex = Number(index);
    if (select.validity.valid) select.removeAttribute('aria-invalid');
    select.dispatchEvent(new win.Event('change', { bubbles: true }));
  };

  function Dropdown({ view }: { view: View }) {
    const [open, setOpen] = useState(false);
    useEffect(() => { if (view.disabled) setOpen(false); }, [view.disabled]);
    const renderChoice = (item: Choice) => (
      <Select.Item key={item.value} value={item.value} disabled={item.disabled} textValue={item.label} className="community-select-option">
        <Select.ItemText>{item.label}</Select.ItemText>
        <Select.ItemIndicator className="community-select-indicator">{icon('check')}</Select.ItemIndicator>
      </Select.Item>
    );
    const labelledBy = view.labelledBy || labels.map(({ label }) => label.id).join(' ') || undefined;
    return (
      <Select.Root value={view.value} onValueChange={choose} open={open} onOpenChange={setOpen} disabled={view.disabled}>
        <Select.Trigger ref={setTrigger} id={triggerId} className="community-select-trigger"
          aria-required={view.required || undefined}
          aria-invalid={view.invalid}
          aria-label={view.ariaLabel} aria-labelledby={labelledBy}
          aria-describedby={view.describedBy} title={view.title}>
          <Select.Value>{view.label}</Select.Value>
          <Select.Icon>{icon('chevron-down')}</Select.Icon>
        </Select.Trigger>
        <Select.Portal container={select.closest<HTMLElement>('[role="dialog"]') ?? doc.body}>
          <Select.Content className="community-select-menu" position="popper" align="start" sideOffset={5} collisionPadding={12}
            onCloseAutoFocus={event => { event.preventDefault(); if (!disposed) trigger?.focus({ preventScroll: true }); }}>
            <Select.ScrollUpButton className="community-select-scroll">{icon('chevron-up')}</Select.ScrollUpButton>
            <Select.Viewport className="community-select-viewport">
              {view.rows.map((row, index) => 'choices' in row
                ? <Select.Group key={`group-${index}`} className="community-select-group"><Select.Label className="community-select-group-label">{row.label}</Select.Label>{row.choices.map(renderChoice)}</Select.Group>
                : renderChoice(row))}
            </Select.Viewport>
            <Select.ScrollDownButton className="community-select-scroll">{icon('chevron-down')}</Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    );
  }

  let renderedSnapshot = '';
  const update = () => {
    if (disposed) return;
    const view = snapshot(select), key = JSON.stringify(view);
    if (key === renderedSnapshot) return;
    renderedSnapshot = key;
    flushSync(() => root.render(<Dropdown view={view} />));
  };
  const reset = () => {
    resetPending = true;
    win.queueMicrotask(() => { resetPending = false; update(); });
  };
  const invalid = (event: Event) => {
    event.preventDefault();
    select.setAttribute('aria-invalid', 'true');
    update();
    trigger?.focus({ preventScroll: true });
  };
  const observer = new win.MutationObserver(update);
  observer.observe(select, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'selected', 'value', 'label', 'hidden', 'required', 'title', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-invalid'] });
  select.addEventListener('change', update);
  select.addEventListener('invalid', invalid);
  const form = select.form;
  form?.addEventListener('reset', reset, true);
  const control: CommunitySelect = {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      select.removeEventListener('change', update);
      select.removeEventListener('invalid', invalid);
      form?.removeEventListener('reset', reset, true);
      host.removeEventListener('change', presentationChange);
      flushSync(() => root.unmount());
      host.remove();
      select.hidden = wasHidden;
      if (nativeMarker === null) select.removeAttribute('data-community-select-native'); else select.setAttribute('data-community-select-native', nativeMarker);
      for (const before of labels) {
        if (before.for === null) before.label.removeAttribute('for'); else before.label.setAttribute('for', before.for);
        if (before.id === null) before.label.removeAttribute('id'); else before.label.setAttribute('id', before.id);
      }
      mounted.delete(select);
    },
  };
  mounted.set(select, control);
  update();
  return control;
}
