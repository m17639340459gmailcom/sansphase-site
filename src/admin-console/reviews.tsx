import { useState } from "react";
import {
  List,
  DataTable,
  SimpleList,
  SelectInput,
  Pagination,
  useDataProvider,
  useNotify,
  useRefresh,
} from "react-admin";
import {
  Box,
  Typography,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Stack,
  Alert,
  useMediaQuery,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { AdminConsoleDataProvider } from "./data-provider.ts";
import type { AdminProfileReview } from "./types.ts";
import { dateText } from "./readers.tsx";

const kindNames = { nickname: "昵称", signature: "签名", avatar: "头像" };

function ReviewDialog({
  record,
  onClose,
}: {
  record: AdminProfileReview;
  onClose: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const provider = useDataProvider<AdminConsoleDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  async function decide(decision: "approve" | "reject") {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await provider.reviewProfile(record.id, decision, {
        reason: decision === "reject" ? reason.trim() : undefined,
      });
      refresh();
      onClose();
      notify(decision === "approve" ? "已通过审核" : "已驳回申请", {
        type: "success",
      });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "审核未完成，请重试",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onClose={pending ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="review-dialog-title"
    >
      <DialogTitle id="review-dialog-title">
        {rejecting ? "驳回资料申请" : `${kindNames[record.kind]}审核`}
      </DialogTitle>
      <DialogContent>
        <Stack gap={2}>
          <Typography color="text.secondary">
            {record.nickname} · {dateText(record.createdAt)}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {record.avatarUrl ? (
            <Box
              component="img"
              src={record.avatarUrl}
              alt="待审核头像"
              sx={{
                width: 160,
                height: 160,
                objectFit: "contain",
                borderRadius: 2,
                border: 1,
                borderColor: "divider",
              }}
            />
          ) : (
            <Box
              sx={{
                p: 2.5,
                bgcolor: "action.hover",
                borderRadius: 1,
                overflowWrap: "anywhere",
                whiteSpace: "pre-wrap",
              }}
            >
              {record.proposedValue || "未提供内容"}
            </Box>
          )}
          {record.advice.length > 0 && (
            <Box>
              <Typography variant="subtitle2" mb={1}>
                已有审核建议
              </Typography>
              {record.advice.map((advice) => (
                <Typography
                  key={advice.id}
                  variant="body2"
                  color="text.secondary"
                >
                  {advice.decision === "approve" ? "建议通过" : "建议驳回"} ·{" "}
                  {advice.reason}
                </Typography>
              ))}
            </Box>
          )}
          {rejecting && (
            <TextField
              name="reason"
              label="驳回原因"
              multiline
              minRows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              inputProps={{ maxLength: 500 }}
              helperText="请说明需要修改的内容"
              disabled={pending}
              autoFocus
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        {rejecting ? (
          <>
            <Button disabled={pending} onClick={() => setRejecting(false)}>
              返回申请
            </Button>
            <Button
              color="error"
              variant="contained"
              disabled={pending || !reason.trim()}
              onClick={() => decide("reject")}
            >
              {pending ? "正在提交…" : "确认驳回"}
            </Button>
          </>
        ) : (
          <>
            <Button disabled={pending} onClick={onClose}>
              关闭
            </Button>
            <Box flex={1} />
            <Button
              disabled={pending}
              color="error"
              onClick={() => setRejecting(true)}
            >
              驳回
            </Button>
            <Button
              disabled={pending}
              variant="contained"
              onClick={() => decide("approve")}
            >
              {pending ? "正在提交…" : "通过审核"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function ProfileReviewList() {
  const [selected, setSelected] = useState<AdminProfileReview | null>(null);
  const mobile = useMediaQuery((theme: Theme) => theme.breakpoints.down("sm"));
  return (
    <>
      <Box sx={{ py: 3 }}>
        <Typography variant="overline" color="text.secondary">
          内容与安全
        </Typography>
        <Typography variant="h4" mt={0.4}>
          资料审核
        </Typography>
        <Typography color="text.secondary" mt={1}>
          审核用户提交的昵称、签名和头像，通过后生效。
        </Typography>
      </Box>
      <List
        title="资料审核"
        exporter={false}
        actions={false}
        perPage={20}
        pagination={<Pagination rowsPerPageOptions={[20]} />}
        empty={false}
        filters={[
          <SelectInput
            key="kind"
            source="kind"
            label="申请类型"
            alwaysOn
            choices={[
              { id: "all", name: "全部类型" },
              ...Object.entries(kindNames).map(([id, name]) => ({ id, name })),
            ]}
          />,
        ]}
        filterDefaultValues={{ kind: "all" }}
        queryOptions={{ refetchOnWindowFocus: false }}
      >
        <Box sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: "divider" }}>
          <Typography fontWeight={600}>当前待审队列</Typography>
          <Typography color="text.secondary" variant="caption">
            按提交时间处理，最多加载 100 条；处理后自动补充后续申请。
          </Typography>
        </Box>
        {mobile ? (
          <SimpleList<AdminProfileReview>
            primaryText={(record) => record.nickname}
            secondaryText={(record) =>
              kindNames[record.kind] + " · " + dateText(record.createdAt)
            }
            rowClick={(_id, _resource, record) => {
              setSelected(record as AdminProfileReview);
              return false;
            }}
            rowSx={() => ({ py: 1.3, borderBottom: 1, borderColor: "divider" })}
          />
        ) : (
          <Box className="console-table">
            <DataTable<AdminProfileReview>
              data-testid="review-table"
              bulkActionButtons={false}
              rowClick={false}
              sx={{ minWidth: 690 }}
            >
              <DataTable.Col<AdminProfileReview>
                source="nickname"
                label="申请用户"
                disableSort
              />
              <DataTable.Col<AdminProfileReview>
                source="kind"
                label="类型"
                disableSort
                render={(record) => (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={kindNames[record.kind as keyof typeof kindNames]}
                  />
                )}
              />
              <DataTable.Col<AdminProfileReview>
                label="申请内容"
                disableSort
                render={(record) =>
                  record.avatarUrl ? (
                    <Box
                      component="img"
                      src={record.avatarUrl}
                      alt="待审核头像"
                      sx={{
                        width: 42,
                        height: 42,
                        objectFit: "cover",
                        borderRadius: 1,
                      }}
                    />
                  ) : (
                    <Typography fontSize={13} sx={{ maxWidth: 260 }} noWrap>
                      {record.proposedValue}
                    </Typography>
                  )
                }
              />
              <DataTable.Col<AdminProfileReview>
                label="提交时间"
                disableSort
                render={(record) => dateText(record.createdAt)}
              />
              <DataTable.Col<AdminProfileReview>
                label="操作"
                disableSort
                render={(record) => (
                  <Button size="small" onClick={() => setSelected(record)}>
                    查看申请
                  </Button>
                )}
              />
            </DataTable>
          </Box>
        )}
      </List>
      {selected && (
        <ReviewDialog
          key={selected.id}
          record={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
