import A11yDialog from "a11y-dialog";

export function createDialog(container: HTMLElement) {
  const dialog = new A11yDialog(container);
  const doc = container.ownerDocument;
  const priorInert = new Map<HTMLElement, boolean>();
  const setBackground = (value: boolean) => {
    doc.body.classList.toggle("dialog-open", value);
    for (const id of ["site-header", "home-stage", "main", "site-footer"]) {
      const node = doc.getElementById(id);
      if (node) {
        if (value) {
          priorInert.set(node, node.inert);
          node.inert = true;
        } else if (priorInert.has(node)) node.inert = priorInert.get(node) ?? false;
      }
    }
    if (!value) priorInert.clear();
  };
  const show = dialog.show.bind(dialog);
  dialog.show = (event) => {
    const wasShown = dialog.shown;
    show(event);
    if (!wasShown && dialog.shown) setBackground(true);
    return dialog;
  };
  dialog.on("hide", () => setBackground(false));
  dialog.on("destroy", () => setBackground(false));
  return dialog;
}
