import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Keep the browser-facing stylesheet as one file while giving each source
// section an owner. Concatenation preserves the original cascade byte order.
export async function composeSiteStyles(sourceDir = "src") {
  const entry = await readFile(join(sourceDir, "styles.css"), "utf8");
  const pattern = /^@import "\.\/(styles-[a-z-]+\.css)";\r?\n/gm;
  const imports = [...entry.matchAll(pattern)].map((match) => match[1]);
  if (
    imports.length < 2 ||
    new Set(imports).size !== imports.length ||
    entry.replace(pattern, "").trim()
  ) {
    throw new Error("src/styles.css must contain unique, ordered local style imports only");
  }
  return Buffer.concat(
    await Promise.all(imports.map((file) => readFile(join(sourceDir, file)))),
  );
}
