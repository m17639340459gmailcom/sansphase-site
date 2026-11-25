import { Alert, Box, Button, Card, ListItemButton, Skeleton, Typography } from "@mui/material";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import ArrowForwardOutlinedIcon from "@mui/icons-material/ArrowForwardOutlined";
import CleaningServicesOutlinedIcon from "@mui/icons-material/CleaningServicesOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import PeopleOutlineIcon from "@mui/icons-material/PeopleOutline";
import WorkspacePremiumOutlinedIcon from "@mui/icons-material/WorkspacePremiumOutlined";
import { Title, useGetList } from "react-admin";
import { Link } from "react-router-dom";
import type { AdminReader, AdminReaderSummary } from "./types.ts";

const metrics = [
  ["全部用户", "total"],
  ["可登录", "active"],
  ["有效 VIP", "vip"],
  ["VIP 已到期", "expiredVip"],
] as const;

const groups = [
  {
    title: "用户与会员",
    items: [
      { to: "/readers", label: "用户管理", description: "查找账号、编辑备注、查看登录记录", Icon: PeopleOutlineIcon },
      { to: "/memberships", label: "VIP 会员", description: "查看有效期、开通和续期", Icon: WorkspacePremiumOutlinedIcon },
      { to: "/profile-reviews", label: "资料审核", description: "审核头像、昵称和签名", Icon: FactCheckOutlinedIcon },
    ],
  },
  {
    title: "网站管理",
    items: [
      { to: "/author-panel", label: "博客作者面板", description: "编辑站点内容和外观", Icon: ArticleOutlinedIcon },
      { to: "/maintenance", label: "清理与维护", description: "检查待清理项目和维护记录", Icon: CleaningServicesOutlinedIcon },
      { to: "/activity", label: "账号操作记录", description: "查询后台操作和处理结果", Icon: HistoryOutlinedIcon },
    ],
  },
];

export function RedesignDashboard() {
  const { meta, isPending, isError, refetch } = useGetList<AdminReader>("readers", {
    pagination: { page: 1, perPage: 20 },
    sort: { field: "createdAt", order: "DESC" },
    filter: { status: "all", membership: "all" },
  });
  const summary = meta?.summary as AdminReaderSummary | undefined;
  return (
    <Box sx={{ width: "100%", maxWidth: 1160, pt: { xs: 3, md: 4 }, pb: 1 }}>
      <Title title="管理概览" />
      <Typography component="h1" variant="h4">管理概览</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.75, mb: 3 }}>
        查看账号和会员情况，进入常用管理功能。
      </Typography>
      {isError && !summary && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={<Button color="inherit" onClick={() => void refetch()}>重试</Button>}
        >
          暂时无法读取账号概况。
        </Alert>
      )}
      <Card
        component="dl"
        aria-label="账号概况"
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" },
          m: 0,
          mb: { xs: 3, md: 4 },
          gap: "1px",
          bgcolor: "divider",
        }}
      >
        {metrics.map(([label, key]) => (
          <Box key={key} sx={{ p: { xs: 2, md: 2.75 }, minWidth: 0, bgcolor: "background.paper" }}>
            <Typography component="dt" color="text.secondary">{label}</Typography>
            <Typography component="dd" sx={{ m: 0, mt: 0.6, fontSize: 30, lineHeight: 1.25, fontWeight: 680, fontVariantNumeric: "tabular-nums" }}>
              {isPending ? <Skeleton width={40} /> : (summary?.[key] ?? "—")}
            </Typography>
          </Box>
        ))}
      </Card>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" }, gap: { xs: 2.5, md: 3 } }}>
        {groups.map(({ title, items }) => (
          <Card component="section" key={title}>
            <Typography
              component="h2"
              variant="h6"
              sx={{ px: { xs: 2, md: 2.5 }, py: 1.75, borderBottom: 1, borderColor: "divider" }}
            >
              {title}
            </Typography>
            {items.map(({ to, label, description, Icon }, index) => (
              <ListItemButton
                key={to}
                component={Link}
                to={to}
                sx={{
                  gap: 1.5,
                  px: { xs: 2, md: 2.5 },
                  py: 1.65,
                  minHeight: 66,
                  borderBottom: index < items.length - 1 ? 1 : 0,
                  borderColor: "divider",
                  color: "text.primary",
                  "&:hover .console-tool-arrow, &:focus-visible .console-tool-arrow": { color: "primary.main" },
                }}
              >
                <Box sx={{ display: "grid", placeItems: "center", width: 34, height: 34, flexShrink: 0, borderRadius: 0.75, bgcolor: "action.selected", color: "primary.main" }}>
                  <Icon fontSize="small" />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={650}>{label}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{description}</Typography>
                </Box>
                <ArrowForwardOutlinedIcon className="console-tool-arrow" fontSize="small" sx={{ color: "text.secondary", flexShrink: 0 }} />
              </ListItemButton>
            ))}
          </Card>
        ))}
      </Box>
    </Box>
  );
}
