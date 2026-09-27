import {parseDocument} from 'htmlparser2';
import render from 'dom-serializer';
import {find} from 'linkifyjs';
import {escapeHTML} from './core.mjs';

// Shared by editor loading, saving and public rendering. Existing anchors and
// code examples are left alone. Sanitization remains the server's responsibility.
export function normalizeBodyLinks(html) {
  const doc = parseDocument(html || '');
  const ignored = new Set(['a','code','pre','script','style','textarea']);
  const parents = [doc];
  while (parents.length) {
    const parent = parents.pop();
    parent.children = parent.children.flatMap(node => {
      if (ignored.has(node.name)) return [node];
      if (node.children) parents.push(node);
      if (node.type !== 'text') return [node];
      const matches = find(node.data, {defaultProtocol:'https'}).filter(link => /^(?:https?:\/\/|mailto:)/i.test(link.href));
      if (!matches.length) return [node];
      let cursor = 0, result = '';
      for (const link of matches) {
        // Chinese prose punctuation is outside a plain URL. Explicit anchors
        // are untouched, including intentionally encoded punctuation in href.
        const label = link.value.split(/[。！？；，、（）【】《》「」『』]/u, 1)[0];
        const href = link.href.slice(0, link.href.length - (link.value.length - label.length));
        result += escapeHTML(node.data.slice(cursor,link.start));
        result += `<a href="${escapeHTML(href)}">${escapeHTML(label)}</a>`;
        cursor = link.start + label.length;
      }
      result += escapeHTML(node.data.slice(cursor));
      return parseDocument(result).children;
    });
    parent.children.forEach((node,i,nodes) => {
      node.parent=parent;node.prev=nodes[i-1]||null;node.next=nodes[i+1]||null;
    });
  }
  return render(doc,{encodeEntities:'utf8'});
}
