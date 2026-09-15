import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createPayloadRuntime } from "../server/payload/runtime.mjs";
if (!process.stdin.isTTY)
  throw Error(
    "Run this account maintenance command in an interactive terminal.",
  );
let muted = false;
const output = new Writable({
  write(chunk, encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});
const input = createInterface({ input: process.stdin, output, terminal: true });
let runtime;
try {
  runtime = await createPayloadRuntime();
  const author = await runtime.payload.findByID({
    collection: "authors",
    id: runtime.settings.authorId,
  });
  const email =
    (await input.question(`作者邮箱（留空保持 ${author.email}）：`)).trim() ||
    author.email;
  process.stdout.write("新密码（输入不显示，至少 12 位）：");
  muted = true;
  const password = await input.question("");
  muted = false;
  process.stdout.write("\n");
  if (password.length < 12) throw Error("密码至少需要 12 位。");
  process.stdout.write("再次输入密码：");
  muted = true;
  const confirmation = await input.question("");
  muted = false;
  process.stdout.write("\n");
  if (password !== confirmation) throw Error("两次输入不一致，账号没有修改。");
  await runtime.payload.update({
    collection: "authors",
    id: author.id,
    data: { email, password, sessions: [], loginAttempts: 0, lockUntil: null },
  });
  console.log("账号已更新，旧会话已退出。请到网站重新登录。");
} finally {
  input.close();
  await runtime?.close();
}
