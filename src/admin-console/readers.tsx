import { useEffect, useRef, useState } from "react";
import {
  List,
  DataTable,
  SimpleList,
  SearchInput,
  SelectInput,
  Pagination,
  useDataProvider,
  useNotify,
  useRefresh,
  useListContext,
} from "react-admin";
import {
  Box,
  Stack,
  Typography,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  TextField,
  Alert,
  Avatar,
  useMediaQuery,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { AdminConsoleDataProvider } from "./data-provider.ts";
import { ReaderLogins } from "./reader-logins.tsx";
import type {
  AdminReader,
  AdminReaderAction,
  AdminReaderSummary,
} from "./types.ts";

export const dateText = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "—";
const statusChoices = [
  { id: "all", name: "全部账号" },
  { id: "active", name: "可登录" },
  { id: "disabled", name: "已停用" },
];
const memberChoices = [
  { id: "all", name: "全部会员状态" },
  { id: "vip", name: "有效 VIP" },
  { id: "expired", name: "VIP 已到期" },
];

function ReaderStatus({ reader }: { reader: AdminReader }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={reader.disabled ? "error" : "success"}
      label={reader.disabled ? "已停用" : "可登录"}
    />
  );
}
function Membership({ reader }: { reader: AdminReader }) {
  return (
    <Chip
      size="small"
      color={reader.vip ? "primary" : "default"}
      variant={reader.vip ? "filled" : "outlined"}
      label={reader.vip ? "有效 VIP" : reader.vipUntil ? "已到期" : "普通用户"}
    />
  );
}

function Summary({ redesign }: { redesign: boolean }) {
  const { meta } = useListContext<AdminReader>();
  const summary = meta?.summary as AdminReaderSummary | undefined;
  if (!summary) return null;
  return (
    <Stack
      direction="row"
      gap={{ xs: 2, md: 5 }}
      sx={{
        px: redesign ? 2 : 2.5,
        py: redesign ? 1.75 : 2.5,
        borderBottom: 1,
        borderColor: "divider",
        flexWrap: "wrap",
        ...(redesign && {
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" },
          gap: 1.5,
          bgcolor: "background.paper",
        }),
      }}
    >
      {(
        [
          ["全部用户", summary.total],
          ["可登录", summary.active],
          ["有效 VIP", summary.vip],
          ["VIP 已到期", summary.expiredVip],
        ] as const
      ).map(([label, count]) => (
        <Box key={label}>
          <Typography color="text.secondary" variant="caption">
            {label}
          </Typography>
          <Typography variant={redesign ? "h6" : "h5"} fontWeight={redesign ? 650 : 600} mt={0.4}>
            {count}
            <Typography
              component="span"
              variant="caption"
              color="text.secondary"
              ml={1}
            >
              人
            </Typography>
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}

type ReaderDialogAction = AdminReaderAction | "remark" | "uid" | "delete";
const actionTitles: Record<ReaderDialogAction, string> = {
  remark: "编辑管理备注",
  uid: "修改显示 UID",
  delete: "永久删除账号",
  disable: "停用账号",
  enable: "恢复账号",
  revoke: "退出所有登录",
  "vip-grant": "开通 / 续期一个月",
  "vip-add-days": "增加指定天数",
  "vip-revoke": "取消 VIP",
};

export function ReaderDialog({
  selected,
  onClose,
}: {
  selected: AdminReader;
  onClose: () => void;
}) {
  const [reader, setReader] = useState(selected);
  const [action, setAction] = useState<ReaderDialogAction | null>(null);
  const [remarkDraft, setRemarkDraft] = useState(selected.remark);
  const [uidDraft, setUidDraft] = useState(selected.uid);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [days, setDays] = useState("30");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const executing = useRef(false);
  const command = useRef<AbortController | null>(null);
  useEffect(() => () => command.current?.abort(), []);
  const provider = useDataProvider<AdminConsoleDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const validUid = /^\d{4,9}$/.test(uidDraft.trim()) && Number(uidDraft) > 0;
  const confirmedEmail =
    confirmEmail.trim().toLowerCase() === reader.email.toLowerCase() &&
    Boolean(confirmEmail.trim());
  async function execute() {
    if (
      !action ||
      executing.current ||
      (action === "uid" && !validUid) ||
      (action === "delete" && !confirmedEmail)
    )
      return;
    executing.current = true;
    const controller = new AbortController();
    command.current = controller;
    setPending(true);
    setError("");
    try {
      if (action === "delete") {
        await provider.deleteReaderAccount(reader.id, confirmEmail, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        onClose();
        refresh();
        notify("账号已永久删除", { type: "success" });
        return;
      }
      const updated =
        action === "remark"
          ? await provider.saveReaderRemark(reader.id, remarkDraft, {
              signal: controller.signal,
            })
          : action === "uid"
            ? await provider.saveReaderUid(reader.id, uidDraft, {
                signal: controller.signal,
              })
            : await provider.readerAction(reader.id, action, {
                days: action === "vip-add-days" ? Number(days) : undefined,
                signal: controller.signal,
              });
      if (controller.signal.aborted) return;
      setReader(updated);
      setAction(null);
      refresh();
      notify(
        action === "remark"
          ? remarkDraft.trim()
            ? "备注已保存"
            : "备注已清空"
          : action === "uid"
            ? "UID 已更新"
            : "操作成功，用户状态已更新",
        { type: "success" },
      );
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : "操作失败，请重试",
        );
    } finally {
      executing.current = false;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  const validDays =
    /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 365;
  return (
    <Dialog
      open
      onClose={pending ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="reader-detail-title"
    >
      <DialogTitle id="reader-detail-title">
        {action ? actionTitles[action] : "用户详情"}
      </DialogTitle>
      <DialogContent>
        <Stack direction="row" alignItems="center" gap={1.5} mb={3}>
          <Avatar sx={{ bgcolor: "secondary.main" }}>
            {reader.nickname.slice(0, 1)}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography fontWeight={650} sx={{ overflowWrap: "anywhere" }}>
              {reader.nickname}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              UID {reader.uid}
            </Typography>
          </Box>
          <Box flex={1} />
          <ReaderStatus reader={reader} />
        </Stack>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {action ? (
          <Stack gap={2}>
            <Typography color="text.secondary">
              {action === "remark"
                ? "仅作者后台可见，支持通过备注搜索用户。不会修改用户昵称。"
                : action === "uid"
                  ? "填写 4–9 位数字，不能全为 0，也不能与其他账号重复。内部账号 ID、昵称和管理备注保持不变。"
                  : action === "delete"
                    ? "将永久删除账号及个人资料，并清理关联的社区数据。此操作不可撤销。必要的登录安全记录、UID 保留及既有备份仍按原有留存规则处理。"
                    : action === "vip-grant"
                      ? "有效 VIP 从当前到期日续期；已到期或未开通时，从现在起开通一个自然月。"
                      : action === "vip-add-days"
                        ? "有效 VIP 从当前到期日延长；已到期或未开通时，从现在起计算。"
                        : action === "vip-revoke"
                          ? "取消后，用户将立即失去 VIP 专属权益。"
                          : action === "disable"
                            ? "停用后该用户将无法登录，并退出现有会话。"
                            : action === "enable"
                              ? "恢复后，该用户可以重新登录。"
                              : "该用户需要重新登录，账号与会员权益保持原状。"}
            </Typography>
            {action === "uid" && (
              <TextField
                name="readerUid"
                label="显示 UID"
                value={uidDraft}
                onChange={(event) => setUidDraft(event.target.value)}
                inputProps={{ inputMode: "numeric", maxLength: 9 }}
                helperText="4–9 位数字，不能全为 0"
                error={!validUid}
                disabled={pending}
                autoFocus
                fullWidth
              />
            )}
            {action === "delete" && (
              <>
                <Alert severity="warning" sx={{ overflowWrap: "anywhere" }}>
                  即将删除：{reader.nickname} · UID {reader.uid} ·{" "}
                  {reader.email}
                </Alert>
                <TextField
                  name="confirmEmail"
                  label="输入完整邮箱确认删除"
                  value={confirmEmail}
                  onChange={(event) => setConfirmEmail(event.target.value)}
                  autoComplete="off"
                  inputProps={{ inputMode: "email", spellCheck: false }}
                  disabled={pending}
                  autoFocus
                  fullWidth
                  helperText="请手动输入上方账号的完整邮箱"
                  error={Boolean(confirmEmail) && !confirmedEmail}
                />
              </>
            )}
            {action === "remark" && (
              <TextField
                name="readerRemark"
                label="管理备注"
                value={remarkDraft}
                onChange={(event) => setRemarkDraft(event.target.value)}
                multiline
                rows={2}
                helperText={`${[...remarkDraft.trim()].length} / 200 字 · 留空保存可清除备注`}
                error={[...remarkDraft.trim()].length > 200}
                disabled={pending}
                autoFocus
                fullWidth
              />
            )}
            {action === "vip-add-days" && (
              <TextField
                name="vipDays"
                label="增加天数"
                type="number"
                value={days}
                onChange={(event) => setDays(event.target.value)}
                inputProps={{ min: 1, max: 365 }}
                helperText="支持 1–365 天"
                error={!validDays}
                disabled={pending}
                autoFocus
              />
            )}
          </Stack>
        ) : (
          <>
            <Box
              component="dl"
              sx={{
                m: 0,
                display: "grid",
                gridTemplateColumns: "100px minmax(0,1fr)",
                gap: 2,
                "& dt": { color: "text.secondary" },
                "& dd": { m: 0, overflowWrap: "anywhere" },
              }}
            >
              <dt>邮箱</dt>
              <dd>{reader.email}</dd>
              <dt>注册时间</dt>
              <dd>{dateText(reader.createdAt)}</dd>
              <dt>最近登录</dt>
              <dd>{dateText(reader.lastLoginAt)}</dd>
              <dt>登录 IP</dt>
              <dd>{reader.lastLoginIp || "—"}</dd>
              <dt>会员状态</dt>
              <dd>
                <Membership reader={reader} />
              </dd>
              <dt>VIP 到期</dt>
              <dd>{dateText(reader.vipUntil)}</dd>
            </Box>
            <Button
              sx={{ mt: 1.5 }}
              onClick={() => {
                setUidDraft(reader.uid);
                setAction("uid");
              }}
            >
              修改 UID
            </Button>
            <Divider sx={{ my: 3 }} />
            <ReaderLogins id={reader.id} formatDate={dateText} />
            <Divider sx={{ my: 3 }} />
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              gap={1}
            >
              <Typography variant="subtitle2">
                管理备注{" "}
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                >
                  仅作者可见
                </Typography>
              </Typography>
              <Button
                onClick={() => {
                  setRemarkDraft(reader.remark);
                  setAction("remark");
                }}
              >
                编辑备注
              </Button>
            </Stack>
            <Typography
              variant="body2"
              color={reader.remark ? "text.primary" : "text.secondary"}
              sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", mt: 0.5 }}
            >
              {reader.remark || "暂未设置备注"}
            </Typography>
            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" mb={1.5}>
              会员管理
            </Typography>
            <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
              <Button
                variant="contained"
                onClick={() => setAction("vip-grant")}
              >
                开通 / 续期一个月
              </Button>
              <Button
                variant="outlined"
                onClick={() => setAction("vip-add-days")}
              >
                增加指定天数
              </Button>
              {reader.vip && (
                <Button color="error" onClick={() => setAction("vip-revoke")}>
                  取消 VIP
                </Button>
              )}
            </Stack>
            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" mb={1}>
              账号访问
            </Typography>
            <Stack direction="row" gap={1}>
              <Button
                variant="outlined"
                color={reader.disabled ? "success" : "error"}
                onClick={() =>
                  setAction(reader.disabled ? "enable" : "disable")
                }
              >
                {reader.disabled ? "恢复账号" : "停用账号"}
              </Button>
              <Button onClick={() => setAction("revoke")}>退出所有登录</Button>
            </Stack>
            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" mb={1}>
              永久删除
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={1}>
              删除无法撤销。如需暂时限制访问，请使用停用账号。
            </Typography>
            <Button
              color="error"
              variant="outlined"
              onClick={() => {
                setConfirmEmail("");
                setAction("delete");
              }}
            >
              永久删除账号
            </Button>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        {action ? (
          <>
            <Button
              disabled={pending}
              onClick={() => {
                setAction(null);
                setError("");
              }}
            >
              返回详情
            </Button>
            <Button
              variant="contained"
              color={action === "delete" ? "error" : "primary"}
              disabled={
                pending ||
                (action === "uid" && !validUid) ||
                (action === "delete" && !confirmedEmail) ||
                (action === "vip-add-days" && !validDays) ||
                (action === "remark" && [...remarkDraft.trim()].length > 200)
              }
              onClick={execute}
            >
              {pending
                ? "正在保存…"
                : action === "remark"
                  ? "保存备注"
                  : action === "uid"
                    ? "保存 UID"
                    : action === "delete"
                      ? "确认永久删除"
                      : action === "vip-add-days"
                        ? "确认增加"
                        : "确认操作"}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>关闭详情</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function ReaderList({
  membership = false,
  redesign = false,
}: { membership?: boolean; redesign?: boolean }) {
  const [selected, setSelected] = useState<AdminReader | null>(null);
  const mobile = useMediaQuery((theme: Theme) => theme.breakpoints.down("sm"));
  return (
    <>
      <Box sx={{ py: redesign ? { xs: 3, md: 4 } : 3 }}>
        {!redesign && (
          <Typography variant="overline" color="text.secondary">
            账号与权益
          </Typography>
        )}
        <Typography variant="h4" component={redesign ? "h1" : "h4"} mt={redesign ? 0 : 0.4}>
          {membership ? "VIP 会员" : "用户管理"}
        </Typography>
        <Typography color="text.secondary" mt={1}>
          {membership
            ? "查看会员有效期，开通、续期或调整 VIP 权益。"
            : "查找用户，查看账号状态与会员权益。"}
        </Typography>
      </Box>
      <List
        title={membership ? "VIP 会员" : "用户管理"}
        storeKey={false}
        disableSyncWithLocation
        exporter={false}
        actions={false}
        perPage={20}
        sort={{ field: "createdAt", order: "DESC" }}
        pagination={<Pagination rowsPerPageOptions={[20]} />}
        filterDefaultValues={{
          status: "all",
          membership: membership ? "vip" : "all",
        }}
        filters={[
          <SearchInput
            key="q"
            source="q"
            placeholder="搜索备注、昵称、邮箱或 UID"
            alwaysOn
            sx={{ minWidth: { sm: 290 } }}
          />,
          <SelectInput
            key="status"
            source="status"
            label="账号状态"
            choices={statusChoices}
            alwaysOn
          />,
          <SelectInput
            key="membership"
            source="membership"
            label="会员状态"
            choices={memberChoices}
            alwaysOn
          />,
        ]}
        empty={false}
        queryOptions={{ refetchOnWindowFocus: false }}
        sx={{
          "& .RaList-actions": { px: 2 },
          "& .RaList-content": { overflow: "hidden" },
        }}
      >
        <Summary redesign={redesign} />
        {mobile ? (
          <SimpleList<AdminReader>
            data-testid="reader-mobile"
            primaryText={(reader) => reader.nickname}
            secondaryText={(reader) => (
              <>
                <Typography component="span" display="block" variant="body2">
                  UID {reader.uid} · {reader.disabled ? "已停用" : "可登录"}
                </Typography>
                {reader.remark && (
                  <Typography
                    component="span"
                    display="block"
                    variant="caption"
                    noWrap
                    title={reader.remark}
                  >
                    备注：{reader.remark}
                  </Typography>
                )}
              </>
            )}
            tertiaryText={(reader) =>
              reader.vip ? "VIP" : reader.vipUntil ? "已到期" : "普通用户"
            }
            rowClick={(_id, _resource, reader) => {
              setSelected(reader as AdminReader);
              return false;
            }}
            rowSx={() => ({ py: 1.3, borderBottom: 1, borderColor: "divider" })}
          />
        ) : (
          <Box className="console-table">
            <DataTable<AdminReader>
              data-testid="reader-table"
              bulkActionButtons={false}
              rowClick={false}
              sx={{ minWidth: 770 }}
            >
              <DataTable.Col<AdminReader>
                source="nickname"
                label="用户"
                disableSort
                render={(reader) => (
                  <Stack direction="row" gap={1.3} alignItems="center">
                    <Avatar
                      sx={{
                        width: 34,
                        height: 34,
                        fontSize: 14,
                        bgcolor: "secondary.main",
                      }}
                    >
                      {reader.nickname.slice(0, 1)}
                    </Avatar>
                    <Box>
                      <Typography fontSize={13} fontWeight={600}>
                        {reader.nickname}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        UID {reader.uid}
                      </Typography>
                      {reader.remark && (
                        <Typography
                          variant="caption"
                          display="block"
                          color="text.secondary"
                          noWrap
                          title={reader.remark}
                          sx={{ maxWidth: 220 }}
                        >
                          备注：{reader.remark}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                )}
              />
              <DataTable.Col<AdminReader>
                source="email"
                label="邮箱"
                disableSort
              />
              <DataTable.Col<AdminReader>
                label="账号状态"
                disableSort
                render={(reader) => <ReaderStatus reader={reader} />}
              />
              <DataTable.Col<AdminReader>
                label="会员"
                disableSort
                render={(reader) => <Membership reader={reader} />}
              />
              <DataTable.Col<AdminReader>
                label={membership ? "VIP 到期时间" : "注册时间"}
                disableSort
                render={(reader) => (
                  <Typography variant="body2" whiteSpace="nowrap">
                    {dateText(membership ? reader.vipUntil : reader.createdAt)}
                  </Typography>
                )}
              />
              <DataTable.Col<AdminReader>
                label="操作"
                disableSort
                render={(reader) => (
                  <Button size="small" onClick={() => setSelected(reader)}>
                    查看用户
                  </Button>
                )}
              />
            </DataTable>
          </Box>
        )}
      </List>
      {selected && (
        <ReaderDialog
          key={selected.id}
          selected={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
