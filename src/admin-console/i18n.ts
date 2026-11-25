import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";

// Official current Polyglot engine; visible product copy is customized locally.
const messages = {
  ...englishMessages,
  ra: {
    ...englishMessages.ra,
    action: {
      ...englishMessages.ra.action,
      toggle_theme: "切换明暗主题",
      search: "搜索",
      refresh: "刷新",
      clear_input_value: "清空",
      remove_all_filters: "清除筛选",
      add_filter: "添加筛选",
      remove_filter: "移除筛选",
      confirm: "确认",
      cancel: "取消",
      close: "关闭",
      show: "查看",
      back: "返回",
      list: "列表",
      sort: "排序",
      select_columns: "显示列",
    },
    page: {
      ...englishMessages.ra.page,
      loading: "正在加载…",
      empty: "暂无%{name}",
      list: "%{name}",
      error: "加载出了问题",
      not_found: "页面不存在",
    },
    navigation: {
      ...englishMessages.ra.navigation,
      no_results: "没有符合条件的记录",
      no_filtered_results: "没有符合筛选条件的记录",
      page_rows_per_page: "每页记录",
      page_range_info: "%{offsetBegin}–%{offsetEnd} / 共 %{total} 条",
      next: "下一页",
      prev: "上一页",
      skip_nav: "跳到主要内容",
    },
    auth: {
      ...englishMessages.ra.auth,
      logout: "退出预览",
      user_menu: "账号菜单",
      auth_check_error: "登录状态已失效，请重新登录",
    },
    notification: {
      ...englishMessages.ra.notification,
      http_error: "服务暂时不可用，请重试",
      data_provider_error: "数据加载失败，请重试",
      canceled: "已取消",
    },
    message: {
      ...englishMessages.ra.message,
      loading: "正在加载，请稍候",
      error: "暂时无法加载，请刷新重试。",
      not_found: "没有找到这个页面。",
      empty: "暂时没有记录。",
      invalid_form: "请检查输入内容",
    },
  },
  resources: {
    readers: { name: "用户" },
    memberships: { name: "VIP 会员" },
    "profile-reviews": { name: "资料审核" },
  },
};
export const i18nProvider = polyglotI18nProvider(
  () => messages,
  "zh",
  [{ locale: "zh", name: "简体中文" }],
  { allowMissing: true },
);
