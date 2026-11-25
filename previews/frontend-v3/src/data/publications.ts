import type { Localized } from "./types";

type Publication = {
  id: string;
  year: string;
  title: Localized;
  authors: string[];
  authorship: Localized;
  kind: Localized;
  citation: string;
  description: Localized;
  publisherUrl: string;
  researchGateUrl: string;
};

/** Authorship and publication details are taken from the published papers. */
export const publications: Publication[] = [
  {
    id: "recommendation-algorithms",
    year: "2025",
    title: {
      zh: "推荐算法在不同领域的应用与发展趋势",
      en: "The Analysis of Recommendation Algorithms in Different Domains and Future Development Trends",
    },
    authors: ["Dingxin Tao"],
    authorship: { zh: "独立作者", en: "Sole author" },
    kind: { zh: "文献综述", en: "Literature review" },
    citation: "Applied and Computational Engineering, 145, 22–28",
    description: {
      zh: "梳理推荐方法在不同应用领域的使用方式，并讨论冷启动、数据稀疏、隐私与可解释性等问题。",
      en: "A review of recommendation methods across application domains, discussing cold starts, sparse data, privacy, and explainability.",
    },
    // The publisher's article page is canonical; the PDF prints a different DOI path.
    publisherUrl: "https://ace.ewapub.com/article/view/21893",
    researchGateUrl: "https://www.researchgate.net/publication/390578939_The_Analysis_of_Recommendation_Algorithms_in_Different_Domains_and_Future_Development_Trends",
  },
  {
    id: "heart-disease-features",
    year: "2021",
    title: {
      zh: "心脏病预测中的生理指标分析",
      en: "Determining which physical parameters are significant for heart disease",
    },
    authors: ["Zhuoning Li", "Dingxin Tao", "Jiaao Zheng", "Chenhao Zhu"],
    authorship: { zh: "共同作者、通讯作者", en: "Co-author and corresponding author" },
    kind: { zh: "探索性分类研究", en: "Exploratory classification study" },
    citation: "Journal of Physics: Conference Series, 2010, 012062",
    description: {
      zh: "基于包含 297 条记录的公开数据集，比较不同特征组合下的分类模型表现，分析各项指标与心脏病标签的关联。这是一次早期机器学习研究实践。",
      en: "An early machine-learning study using a publicly available dataset of 297 records to compare classifiers with different feature sets and examine which variables were associated with heart-disease labels.",
    },
    publisherUrl: "https://doi.org/10.1088/1742-6596/2010/1/012062",
    researchGateUrl: "https://www.researchgate.net/publication/354560061_Determining_which_physical_parameters_are_significant_for_heart_disease",
  },
];
