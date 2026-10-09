// The shared template keeps its approved layout, including home.css's common
// header/viewport rules. Only the unused renderer-specific stylesheet is omitted.
export function communityHostDocument(html: string, modules: readonly string[] = ['community-runtime-client.mjs']): string {
  const base = /\bdata-static-base="([^"]+)"/.exec(html)?.[1] || './';
  const stylesheet = `<link rel="preload" as="style" href="${base}community.css"${base === './' ? '' : ' crossorigin="anonymous"'}>`;
  const preloads = [...new Set(modules)].filter(path => /^(?:chunks\/)?[\w.-]+\.mjs$/.test(path))
    .map(path => `${base}${path}`)
    .filter(href => !html.includes(`rel="modulepreload" href="${href}"`))
    .map(href => `<link rel="modulepreload" href="${href}"${base === './' ? '' : ' crossorigin="anonymous"'}>`).join('');
  return html
    .replace(/<link\b[^>]*>/g, tag => /\brel="stylesheet"/.test(tag) && /\bhref="[^"?]*\/cosmos\.bundle\.css(?:\?[^\"]*)?"/.test(tag) ? '' : tag)
    .replace(/(<meta\b[^>]*\bname="theme-color"[^>]*\bcontent=")[^"]*(")/, '$1#e8e2d6$2')
    .replace('</head>', `${stylesheet}${preloads}</head>`)
    .replace(/<body\b/, '<body data-community-only="true" data-community-boot="pending" data-community-theme="light"');
}
