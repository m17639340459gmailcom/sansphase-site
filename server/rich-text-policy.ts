// The author editor and public renderer use the same safe text formatting.
// No positioning, URLs, or arbitrary CSS may enter through article markup.
export const richTextAttributes = { span: ["style"], p: ["style", "data-book-block"], section: ['data-book-chapter','data-book-title'], h1:['data-book-block'],h2:['data-book-block'],h3:['data-book-block'],h4:['data-book-block'],ul:['data-book-block'],ol:['data-book-block'],blockquote:['data-book-block'],pre:['data-book-block'],table:['data-book-block'] };
export const richTextStyles = {
  "*": {
    color: [/^#[\da-f]{3}(?:[\da-f]{3})?$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/],
    "font-family": [/^(?:"|')?(?:New Tegomin|Noto Sans SC|Microsoft YaHei|Georgia|Consolas)(?:"|')?$/],
    "font-size": [/^(?:14|16|18|20|24|28|32)px$/],
  },
};
