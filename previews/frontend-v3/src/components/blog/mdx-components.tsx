import type { MDXComponents } from "mdx/types";
import type { AnchorHTMLAttributes } from "react";
import { Pre } from "./pre";
import { BlogImage } from "./blog-image";

function Anchor(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const href = props.href ?? "";
  const external = /^https?:\/\//.test(href);
  return (
    <a
      {...props}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer noopener" : undefined}
    />
  );
}

export const mdxComponents: MDXComponents = {
  a: Anchor,
  pre: Pre,
  BlogImage,
};
