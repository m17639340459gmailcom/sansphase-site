import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Title, useCheckAuth } from "react-admin";
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import {
  activityNames,
  cleanupFeedback,
  cleanupKinds,
  createMaintenanceApi,
  retainCleanupSelection,
} from "./maintenance-api.ts";
import type {
  ActivityRow,
  CleanupKind,
  CleanupQueues,
  CleanupRow,
} from "./maintenance-api.ts";
import { dateText } from "./readers.tsx";

const names: Record<CleanupKind, string> = {
  expired: "过期申请",
  files: "头像清理",
  versions: "旧版本清理",
  media: "附件清理",
};
const descriptions: Record<CleanupKind, string> = {
  expired:
    "仅处理已过期且未完成邮箱验证的申请，不会清理仍在验证中的申请或已注册用户。",
  files: "处理替换头像后留下的文件。仍被用户资料或审核申请使用的图片会保留。",
  versions:
    "重试清理已删除内容留下的旧版本。仍存在的文章、资源和公告及其版本会保留。",
  media:
    "处理已删除内容留下的附件。仍被其他内容引用的文件会保留；旧版本尚未清理完成时会暂缓处理。",
};
const emptySelection = (): Record<CleanupKind, string[]> => ({
  expired: [],
  files: [],
  versions: [],
  media: [],
});
const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : "请求未完成，请稍后重试。";
const unauthorized = (failure: unknown) =>
  failure &&
  typeof failure === "object" &&
  "status" in failure &&
  [401, 403].includes(Number(failure.status));

/** Keep the last successful page visible during refresh and discard stale/unmounted responses. */
function usePrivatePage<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const checkAuth = useCheckAuth(),
    pending = useRef<AbortController | null>(null),
    alive = useRef(true);
  const reject = useCallback(
    (failure: unknown) => {
      if (!alive.current) return;
      setError(errorText(failure));
      if (unauthorized(failure)) {
        setData(null);
        void checkAuth().catch(() => {});
      }
    },
    [checkAuth],
  );
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    try {
      const value = await load(controller.signal);
      if (!controller.signal.aborted && alive.current) {
        setData(value);
        return value;
      }
    } catch (failure) {
      if (!controller.signal.aborted) reject(failure);
    } finally {
      if (alive.current && pending.current === controller) setLoading(false);
    }
    return null;
  }, [load, reject]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, [refresh]);
  return { data, error, loading, refresh, reject };
}

export function MaintenancePage() {
  const api = useMemo(() => createMaintenanceApi(), []);
  const load = useCallback(
    (signal: AbortSignal) => api.loadQueues(signal),
    [api],
  );
  const page = usePrivatePage<CleanupQueues>(load);
  const [kind, setKind] = useState<CleanupKind>("expired"),
    [selected, setSelected] = useState(emptySelection);
  const [offset, setOffset] = useState(0),
    [plan, setPlan] = useState<{
      kind: CleanupKind;
      rows: CleanupRow[];
    } | null>(null);
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState<ReturnType<
      typeof cleanupFeedback
    > | null>(null);
  const [dialogError, setDialogError] = useState("");
  const mutation = useRef<AbortController | null>(null),
    lock = useRef(false);
  useEffect(
    () => () => {
      mutation.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!page.data) {
      setSelected(emptySelection());
      setPlan(null);
      return;
    }
    setSelected(
      (current) =>
        Object.fromEntries(
          cleanupKinds.map((key) => [
            key,
            retainCleanupSelection(current[key], page.data![key]),
          ]),
        ) as Record<CleanupKind, string[]>,
    );
  }, [page.data]);
  const rows = page.data?.[kind] || [],
    selection = selected[kind];
  const currentPage = Math.min(
      offset,
      Math.max(0, Math.ceil(rows.length / 20) - 1),
    ),
    visible = rows.slice(currentPage * 20, (currentPage + 1) * 20);
  const selectedOnPage = visible.filter((row) =>
    selection.includes(row.id),
  ).length;
  function toggle(ids: string[], checked: boolean) {
    if (busy || page.loading) return;
    setSelected((current) => ({
      ...current,
      [kind]: checked
        ? [...new Set([...current[kind], ...ids])].slice(0, 100)
        : current[kind].filter((id) => !ids.includes(id)),
    }));
  }
  async function execute() {
    if (!plan || lock.current) return;
    lock.current = true;
    setBusy(true);
    setDialogError("");
    setFeedback(null);
    const controller = new AbortController();
    mutation.current = controller;
    try {
      const result = await api.cleanup(
        plan.kind,
        plan.rows.map((row) => row.id),
        plan.rows,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setFeedback(cleanupFeedback(result, plan.rows.length));
      setPlan(null);
      await page.refresh();
    } catch (failure) {
      if (!controller.signal.aborted) {
        setDialogError(errorText(failure));
        if (unauthorized(failure)) {
          setPlan(null);
          page.reject(failure);
        }
      }
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <Box sx={{ py: 3 }}>
      <Title title="清理与维护" />
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        gap={2}
        mb={2}
      >
        <Box>
          <Typography variant="h4">清理与维护</Typography>
          <Typography color="text.secondary" mt={1}>
            系统会自动处理；未完成的项目可以在这里重试。
          </Typography>
        </Box>
        <Button
          onClick={() => {
            void page.refresh();
          }}
          disabled={busy || page.loading}
        >
          刷新列表
        </Button>
      </Stack>
      {page.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {page.error} {page.data ? "当前仍显示上次读取的列表。" : ""}
        </Alert>
      )}
      {feedback && (
        <Alert severity={feedback.severity} sx={{ mb: 2 }}>
          {feedback.message}
        </Alert>
      )}
      <Card>
        <Tabs
          value={kind}
          onChange={(_, value: CleanupKind) => {
            setKind(value);
            setOffset(0);
            setFeedback(null);
          }}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="清理分类"
        >
          {cleanupKinds.map((key) => (
            <Tab key={key} value={key} label={names[key]} disabled={busy} />
          ))}
        </Tabs>
        {page.loading ? (
          <LinearProgress aria-label="正在读取待处理项目" />
        ) : (
          <Box sx={{ height: 4 }} />
        )}
        <Box sx={{ p: { xs: 2, md: 3 } }}>
          <Typography>{descriptions[kind]}</Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "center" }}
            gap={1.5}
            mt={2}
            mb={2}
          >
            <Typography color="text.secondary">
              本批 {rows.length} 项 · 已选 {selection.length} 项（每次最多 100
              项）
            </Typography>
            <Button
              variant="contained"
              disabled={!selection.length || busy || page.loading || !page.data}
              onClick={() => {
                setDialogError("");
                setPlan({
                  kind,
                  rows: rows.filter((row) => selection.includes(row.id)),
                });
              }}
            >
              处理所选项目
            </Button>
          </Stack>
          {rows.length >= 100 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              这里只显示当前待处理批次。处理完成后刷新，可继续查看剩余项目。
            </Alert>
          )}
          <TableContainer>
            <Table size="small" aria-label={names[kind]}>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={
                        visible.length > 0 && selectedOnPage === visible.length
                      }
                      indeterminate={
                        selectedOnPage > 0 && selectedOnPage < visible.length
                      }
                      disabled={
                        !visible.length ||
                        busy ||
                        page.loading ||
                        (selection.length >= 100 && selectedOnPage === 0)
                      }
                      onChange={(_, checked) =>
                        toggle(
                          visible.map((row) => row.id),
                          checked,
                        )
                      }
                      inputProps={{ "aria-label": "选择当前页项目" }}
                    />
                  </TableCell>
                  <TableCell>待处理项目</TableCell>
                  <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>
                    {kind === "expired" ? "过期时间" : "记录时间"}
                  </TableCell>
                  <TableCell>状态</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((row) => (
                  <TableRow
                    key={row.id}
                    hover
                    selected={selection.includes(row.id)}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selection.includes(row.id)}
                        disabled={
                          busy ||
                          page.loading ||
                          (selection.length >= 100 &&
                            !selection.includes(row.id))
                        }
                        onChange={(_, checked) => toggle([row.id], checked)}
                        inputProps={{
                          "aria-label": `选择 ${row.title} ${row.id}`,
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{row.title}</Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ overflowWrap: "anywhere" }}
                      >
                        {row.description}
                      </Typography>
                    </TableCell>
                    <TableCell
                      sx={{
                        display: { xs: "none", sm: "table-cell" },
                        whiteSpace: "nowrap",
                      }}
                    >
                      {dateText(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={row.needsRetry ? "可重试" : "待处理"}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                      {page.loading
                        ? "正在读取…"
                        : page.data
                          ? "暂无待处理项目"
                          : "列表尚未读取，请重试"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={rows.length}
            page={currentPage}
            rowsPerPage={20}
            rowsPerPageOptions={[20]}
            onPageChange={(_, value) => setOffset(value)}
            labelDisplayedRows={({ from, to, count }) =>
              `本批 ${from}–${to} / ${count} 项`
            }
          />
        </Box>
      </Card>
      <Dialog
        open={Boolean(plan)}
        onClose={busy ? undefined : () => setPlan(null)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="cleanup-confirm-title"
      >
        <DialogTitle id="cleanup-confirm-title">
          确认处理 {plan?.rows.length || 0} 项
          {plan ? ` · ${names[plan.kind]}` : ""}
        </DialogTitle>
        <DialogContent>
          <Stack gap={2}>
            <Typography>
              只提交以下所选项目。服务器会再次检查是否仍可清理；符合条件的文件删除后无法撤销。
            </Typography>
            {plan && (
              <Typography color="text.secondary">
                {descriptions[plan.kind]}
              </Typography>
            )}
            {dialogError && (
              <Alert severity="error">{dialogError} 所选项目已保留。</Alert>
            )}
            <Box
              component="ul"
              sx={{
                m: 0,
                pl: 2.5,
                maxHeight: 240,
                overflowY: "auto",
                scrollbarWidth: "thin",
                scrollbarColor:
                  "var(--mui-palette-divider, #b9b2a6) transparent",
              }}
            >
              {plan?.rows.map((row) => (
                <Box
                  component="li"
                  key={row.id}
                  sx={{ mb: 1, overflowWrap: "anywhere" }}
                >
                  <Typography variant="body2">{row.title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {row.description}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setPlan(null)} disabled={busy}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              void execute();
            }}
            disabled={busy || !plan}
          >
            {busy ? "正在处理…" : "确认处理所选"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function activityDescription(row: ActivityRow) {
  if (row.action === "remark")
    return row.cleared ? "已清空备注" : `已保存备注（${row.length} 字）`;
  if (row.action === "uid-change") return `UID ${row.from} → ${row.to}`;
  if (row.action === "vip-add-days")
    return `增加 ${row.days} 天${row.until ? ` · 到期 ${dateText(row.until)}` : ""}`;
  return row.until ? `到期 ${dateText(row.until)}` : "";
}
export function ActivityPage() {
  const api = useMemo(() => createMaintenanceApi(), []);
  const load = useCallback(
    (signal: AbortSignal) => api.loadActivity(signal),
    [api],
  );
  const page = usePrivatePage<ActivityRow[]>(load);
  return (
    <Box sx={{ py: 3 }}>
      <Title title="近期操作" />
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
        gap={2}
      >
        <Box>
          <Typography variant="h4">近期操作</Typography>
          <Typography color="text.secondary" mt={1}>
            展示近期记录中的账号、VIP 和备注操作，最多 20 条。
          </Typography>
        </Box>
        <Button
          onClick={() => {
            void page.refresh();
          }}
          disabled={page.loading}
        >
          刷新记录
        </Button>
      </Stack>
      <Alert severity="info" sx={{ mb: 2 }}>
        此处不是完整历史记录。管理备注只显示是否修改或清空，不显示备注内容。
      </Alert>
      {page.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {page.error} {page.data ? "当前仍显示上次读取的记录。" : ""}
        </Alert>
      )}
      <Card>
        {page.loading ? (
          <LinearProgress aria-label="正在读取操作记录" />
        ) : (
          <Box sx={{ height: 4 }} />
        )}
        <TableContainer>
          <Table aria-label="近期账号操作">
            <TableHead>
              <TableRow>
                <TableCell>操作</TableCell>
                <TableCell>账号</TableCell>
                <TableCell>时间</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {page.data?.map((row, index) => (
                <TableRow
                  key={`${row.at}:${row.readerId}:${row.action}:${index}`}
                >
                  <TableCell>
                    <Typography variant="body2">
                      {activityNames[row.action]}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {activityDescription(row)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ overflowWrap: "anywhere" }}>
                    {row.uid
                      ? `UID ${row.uid}`
                      : `账号 ${row.readerId.slice(0, 8)}…`}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {dateText(row.at)}
                  </TableCell>
                </TableRow>
              ))}
              {!page.data?.length && (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 6 }}>
                    {page.loading
                      ? "正在读取…"
                      : page.data
                        ? "暂无近期操作记录"
                        : "记录尚未读取，请重试"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
}
