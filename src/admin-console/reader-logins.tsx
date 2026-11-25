import { useEffect, useState } from "react";
import { useDataProvider } from "react-admin";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import type { AdminConsoleDataProvider } from "./data-provider.ts";
import type { AdminReaderLogin } from "./types.ts";

type History =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; events: AdminReaderLogin[] };

export function ReaderLogins({
  id,
  formatDate,
}: {
  id: string;
  formatDate: (value: string) => string;
}) {
  const provider = useDataProvider<AdminConsoleDataProvider>();
  const [history, setHistory] = useState<History>({ state: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setHistory({ state: "loading" });
    void provider
      .readerLogins(id, { signal: controller.signal })
      .then((events) => {
        if (!controller.signal.aborted) setHistory({ state: "ready", events });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setHistory({
            state: "error",
            message:
              error instanceof Error ? error.message : "登录记录暂时无法读取。",
          });
      });
    return () => controller.abort();
  }, [id, retry, provider]);
  return (
    <Box
      component="section"
      aria-labelledby="reader-logins-title"
      aria-busy={history.state === "loading"}
    >
      <Typography id="reader-logins-title" variant="subtitle2" mb={1}>
        最近登录记录
      </Typography>
      {history.state === "loading" ? (
        <Typography color="text.secondary" variant="body2" role="status">
          正在读取登录记录…
        </Typography>
      ) : history.state === "error" ? (
        <Alert
          severity="error"
          action={
            <Button onClick={() => setRetry((value) => value + 1)}>
              重试登录记录
            </Button>
          }
        >
          {history.message}
        </Alert>
      ) : !history.events.length ? (
        <Typography color="text.secondary" variant="body2">
          尚无成功登录记录
        </Typography>
      ) : (
        <Stack component="ol" gap={1.5} sx={{ p: 0, m: 0, listStyle: "none" }}>
          {history.events.map((event) => (
            <Box component="li" key={event.id}>
              <Stack
                direction="row"
                useFlexGap
                flexWrap="wrap"
                justifyContent="space-between"
                gap={1}
              >
                <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                  {event.ip || "未记录 IP"}
                </Typography>
                <Typography
                  component="time"
                  dateTime={event.at}
                  variant="caption"
                  color="text.secondary"
                >
                  {formatDate(event.at)}
                </Typography>
              </Stack>
              {event.userAgent && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", overflowWrap: "anywhere" }}
                >
                  {event.userAgent}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
