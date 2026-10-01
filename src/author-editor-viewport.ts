import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';

const pasteViewport = new PluginKey<boolean>('authorPasteViewport');

export const AuthorEditorViewport = Extension.create({
  name: 'authorEditorViewport',
  addProseMirrorPlugins() {
    return [new Plugin<boolean>({
      key: pasteViewport,
      state: {
        init: () => false,
        apply(transaction) {
          // Link normalization and book identities may append to the paste.
          const root: Transaction | undefined = transaction.getMeta('appendedTransaction');
          return Boolean(transaction.getMeta('paste') || root?.getMeta('paste'));
        },
      },
      props: {
        handlePaste(_view, event, slice) {
          // An empty modern clipboard must not enter ProseMirror's legacy
          // hidden-input fallback: focusing it scrolls the glass dialog to 0.
          return Boolean(event.clipboardData && !event.clipboardData.files.length && slice.size === 0);
        },
        handleScrollToSelection(view) {
          // Keep the viewport for this paste only. A subsequent typing, undo
          // or navigation transaction retains the editor's normal caret scroll.
          return pasteViewport.getState(view.state) === true;
        },
      },
    })];
  },
});
