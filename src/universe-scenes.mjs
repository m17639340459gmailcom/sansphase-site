// Homepage chapters lead to existing routes. Real projects/articles stay in
// data.mjs; chapter copy does not invent a portfolio or community activity.
export const universeScenes = [
  {
    id: "welcome",
    ariaLabel: "深空场景一",
    ariaLabelEn: "Deep space view one",
  },
  {
    id: "notes",
    ariaLabel: "博客",
    ariaLabelEn: "Blog",
    title: "博客",
    titleEn: "Blog",
    label: "BLOG / NOTES",
    description: "记录学习、创作、建设过程。",
    descriptionEn: "Notes on learning, making and building.",
    links: [{ href: "#/notes", zh: "阅读博客", en: "Read the blog" }],
  },
  {
    id: "works",
    ariaLabel: "作品 资料",
    ariaLabelEn: "Works and materials",
    title: "作品 资料",
    titleEn: "Works / Materials",
    label: "WORKS / MATERIALS",
    description: "查看项目成果，也可继续探索资料中心。",
    descriptionEn: "Explore projects and continue into the resource center.",
    links: [
      { href: "#/works", zh: "浏览作品", en: "Explore works" },
      { href: "#/resources", zh: "查看资料", en: "Browse materials" },
    ],
  },
  {
    id: "community",
    ariaLabel: "社区交流 资源中心",
    ariaLabelEn: "Community and resource center",
    title: "社区交流　资源中心",
    titleEn: "Community / Resources",
    label: "COMMUNITY / RESOURCES",
    description: "围绕 AI、学习、创作交流，整理可复用的资料。",
    descriptionEn: "Conversations about AI and learning, with reusable resources.",
    links: [
      { href: "#/community", zh: "进入社区", en: "Visit the community" },
      { href: "#/resource-center", zh: "资源中心", en: "Resource center" },
    ],
  },
];
