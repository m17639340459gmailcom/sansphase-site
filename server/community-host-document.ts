// The shared template keeps its approved layout, including home.css's common
// header/viewport rules. Only the unused renderer-specific stylesheet is omitted.
export function communityHostDocument(html: string): string {
  const base = /\bdata-static-base="([^"]+)"/.exec(html)?.[1] || './';
  const stylesheet = `<link rel="preload" as="style" href="${base}community.css"${base === './' ? '' : ' crossorigin="anonymous"'}>`;
  return html
    .replace(/<link\b[^>]*>/g, tag => /\brel="stylesheet"/.test(tag) && /\bhref="[^"?]*\/cosmos\.bundle\.css(?:\?[^\"]*)?"/.test(tag) ? '' : tag)
    .replace('</head>', `${stylesheet}</head>`)
    .replace(/<body\b/, '<body data-community-only="true" data-community-boot="pending"');
}
