// Full page fixture with author colours; does not read a database or contact production.
import { createPreviewServer } from "../../server.mjs";
import { makeReadingDemo } from "../../scripts/fixtures/reading-demo.mjs";
const data = {
  ...makeReadingDemo(),
  author: null,
  announcements: [
    {
      title: "边框核对示例",
      summary: "仅用于本地检查",
      image: "./assets/materials/eso-triangulum.jpg",
    },
  ],
  profile: {
    name: "样式核对",
    signature: "本地示例",
    bio: "作者自定义薄荷色边框",
    socialLinks: [],
    appearance: { cardBorderColor: "#afe5d7", cardBorderOpacity: 0.8 },
  },
};
const options = {
  contentService: { snapshot: async () => ({ data: structuredClone(data) }) },
  release: "local-card-colour-review",
};
const server = createPreviewServer(options);
server.listen(4211, "127.0.0.1", () =>
  console.log("Local card colour review: http://127.0.0.1:4211/#/notes"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
