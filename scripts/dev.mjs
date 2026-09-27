import { createPayloadRuntime } from "../server/payload/runtime.mjs";
import { createPreviewServer } from "../server.mjs";
const runtime = await createPayloadRuntime();
const server = createPreviewServer(runtime);
const port = Number(process.env.PORT || 4176);
server.on("error", async (error) => {
  console.error(error.message);
  await runtime.close();
  process.exitCode = 1;
});
server.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `Payload website and author mode: http://127.0.0.1:${port}/?v=0.101#/notes`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await runtime.close();
      process.exit(0);
    }),
  );
