# 登录滑块验证

## 范围与状态

2026-10-11 按项目所有者要求，将登录的点击计算验证改成图片滑块，经本地验收和上线前检查后已启用主站生产配置。保护读者登录、作者直接登录，以及读者入口中的作者登录。注册、找回密码、发帖、回复、已有会话和香港社区身份桥接维持现有流程。

拼图生成与坐标、基础轨迹校验复用 Tianai 1.5.5。它是免费自托管开源组件，稳定发布于 2026-02-28。默认 Simple 仅检查位置，本站显式启用 BasicCaptchaTrackValidator，并适配真实输入轨迹。该库的基础规则不能保证识别所有自动化或视觉识别脚本；原有来源检查、持久限速与密码错误锁定继续保留。

Node/Payload 仍负责账号。Java 21 独立服务仅处理拼图，不接收邮箱、密码、账号、会话或生产数据库。生成服务使用原创程序绘制的多张背景，不接收远程资源地址；图片与拼图算法由原库生成。旧 ALTCHA 依赖、Worker 和计算分支已经移除。

## 页面流程

登录表单显示“点击滑块验证”。登录页只准备本站挑战；点击后按需加载滑块交互模块，显示背景、拼图、刷新和取消。图片实际加载、核对尺寸后才能拖动。鼠标、触摸和键盘方向键记录真实操作；松开或键盘 Enter 都请求服务器验证，前端位置对齐不能自行生成有效登录凭据。刷新获取新拼图；取消保留已填账号与密码。

验证通过后才可提交登录，凭据仅留在当前表单内存。修改账号或密码、过期、登录提交后失效。登录请求等待时验证和登录按钮一直锁住，重复点击不产生第二次请求。导航、关闭作者窗口、表单移除及超时会销毁面板、释放指针捕获与监听器、中止请求。验证库不保存账号或凭据至 localStorage，不加载远程脚本或外部图片。

背景和透明模板使用同一缩放，纵向拼图位置已包含在模板 PNG 中，只横向移动。显示位移与真实轨迹距离一致；DTO 尺寸与 left 为整数。空闲时尺寸变化会重新量取并归零，拖动或校验中改变尺寸会取消该次验证；开始、松开和接收结果时也核对尺寸，防止缩窗、手机转屏后错误使用旧尺寸。

准备请求最长 30 秒；图片加载最长 15 秒；交互最长 120 秒且受挑战有效期限制；匹配请求最长 25 秒，实际 Node 到 Java 的处理最长 5 秒。网络故障不能当作“已关闭验证”。登录请求保持原有独立 30 秒期限。

登录表单的准备请求和滑块面板只在实际离开所属地址、表单移除或主动取消时中止；浏览器排队到达的同地址 `hashchange` 不能取消新表单。身份更新先取消旧表单工作，再渲染新表单，避免新请求被旧监听器清理。非页面主动中止的传输异常显示可重试状态，不永久停留在准备中。

浏览器后退缓存保存页面时取消未完成验证并清除旧 proof；恢复同一表单后重新准备挑战。正在提交登录的锁保留，恢复不会重复提交或复用旧 proof。上述处理仍使用原来的验证模块和交互，不改变验证签名、有效期或服务端核验。

## 接口与服务边界

- POST /api/reader/login-challenge 和 /api/author/login-challenge：只允许空 JSON 对象，公开图片、尺寸及签名挑战令牌。
- POST /api/reader/login-challenge/verify 和 /api/author/login-challenge/verify：提交 token 与真实 track，匹配成功才返回独立签名 proof。
- 密码登录继续原接口及 email/password 正文，proof 通过 X-Login-Verification 请求头传递。

所有公开验证请求检查本站精确 Origin 和原有 X-Reader-Request / X-Author-Request 意图头。签名挑战绑定当前登录入口、来源与 HttpOnly、SameSite=Strict 的浏览器随机凭据。challenge 与 login proof 使用不同 purpose 和签名密钥；拿 challenge 或修改浏览器状态不能代替 proof。

挑战最多 120 秒，登录 proof 最多 90 秒且不能超过挑战到期时间，页面保守按最多 85 秒及挑战到期前 5 秒限制。Node 强制期限，不依赖上游缓存周期清扫。挑战在调用 Java 前用私有 SQLite 原子记录一次性消费；答错或服务故障也必须取新挑战。登录时再原子消费独立 proof nonce，跨请求、进程重启与并发不能复用。读者入口的作者代理仅消费一次。

页面剩余期限参考已有 HTTP `Date` 响应头，结合浏览器 `performance.now()` 计时并扣除请求等待时间，不再拿设备的 `Date.now()` 与服务器到期时间直接比较。响应缺少或损坏 `Date` 时使用有上限的相对计时，最终有效性仍交给服务器。拖动轨迹保持既有时间字段格式，用固定日期锚点加单调计时，避免用户校时造成轨迹倒退；不引入新验证服务或依赖。

挑战、匹配、登录凭据核验分别复用持久 auth 限流，每 IP 每分钟 30 次、每小时 200 次，读者与作者入口共享各动作的额度。验证 JSON 读取有独立 10 秒绝对期限；challenge 最多 4 KiB、verify 最多 40 KiB，轨迹最多 512 点；超界、未知字段与非有限数字在内部服务前拒绝。上传的原有期限未被改变。

主站 Nginx 模板对 challenge 和 verify 分别配置 4 KiB、40 KiB 正文上限、10 秒正文读取间隔和 10 秒上游响应间隔，以及各自每 IP 30 次/分钟、burst 10 的额度；它们不使用原密码登录每分钟 5 次的限流桶。Nginx 的间隔期限不代替 Node 的正文绝对期限。真实配置必须合并这些规则并执行 nginx -t，源码模板本身不代表线上已启用。

私有 Java 仅监听 127.0.0.1，要求独立 Bearer secret，固定接口 /challenge、/verify 和认证后的 /health，不接收任意资源 URL。Node 只接受字面 loopback HTTP origin，禁止重定向，最多 4 个并发内部请求、最多 750 KB 响应流。私有服务和 Node 都明确投影公开图片字段，不返回正确坐标或缓存数据。挑战缓存复用 Caffeine，2048 条上限、120 秒期限、原子读取移除。进程重启使未完成拼图失效，不触碰账号、VIP 或帖子数据。

## 配置和运行

主站私有配置 loginVerification 未设置、或只有 enabled:false 时保持兼容。启用配置要求 enabled:true、engine:tianai、serviceOrigin 为带明确端口的 http://127.0.0.1 来源，以及 hmacSecret、keySecret、serviceSecret 三份独立随机密钥。每份至少 32 字节，serviceSecret 为可打印 ASCII；服务环境 CAPTCHA_SERVICE_SECRET 与 Node 的 serviceSecret 相同。不得复用账号、会话、桥接或加密密钥，不得写入源码、Git 或日志。缺失或错误启用配置应阻止启动，不静默放行。

本地先设置已验证的 JAVA_HOME、MAVEN_HOME（Java 21+、Maven 稳定版），执行 pnpm captcha:build。Windows 在本任务已校验下载的 .local/runtime/captcha 下可使用默认路径；发布不能依赖此本机路径。构建使用官方 Maven Launcher、严格依赖校验，先测试再生成 jar。pnpm build 只构建网站；不会在普通网站构建时自动安装 Java。

Maven JAR 插件启用 forceCreation：每次从项目 classes 重新生成原始 jar，再由 Shade 合并当前依赖，防止增量打包把上一次完整依赖包作为输入、残留旧依赖类。此设置遵循 [Maven JAR 插件官方说明](https://maven.apache.org/plugins/maven-jar-plugin/jar-mojo.html#forceCreation)。

pnpm captcha:preview 自动启动仅监听本机的 Java 服务，再用新建合成 Payload 数据启动 http://127.0.0.1:4244/#/account。私有验证端口默认 4253，可以用 CAPTCHA_PREVIEW_PORT 改动。演示账号 reader@example.test 与 owner@example.test、密码 DemoLogin2026!，不读取生产配置。关闭预览会终止其 Java 子进程。

正式部署是额外的 Java 常驻进程，需要独立健康检查、更新和资源预算。本次已按 deploy/sansphase-login-captcha.service 与 login-captcha.env.example 完成独立服务配置，真实密钥不进入模板。先从明确源码构建、验证 jar 和许可证，放入独立 /opt/sansphase-captcha/current，使用 /etc/sansphase/login-captcha.env 私有环境文件，核对 Java 21、认证后的健康检查和实际内存，再启用主站配置。不要公网开放验证服务、不要用替换账号认证的方式接入。Nginx 发布检查需给挑战和匹配独立额度与小正文规则，不能占用原来低频密码登录额度。验证服务故障时登录拒绝并允许重试，不能自动改配置绕过。

私有 login-verification.db 快照继续纳入主站备份，恢复只轮换挑战与 proof 的密钥，账号和会话密钥及内部服务密钥保持原值。源码发布清单明确跳过 Maven target 输出；jar、依赖缓存、临时预览和真实配置不提交到 Git。

## 许可和官方资料

Tianai tag 根 LICENSE 标注 Apache-2.0，但发布的 Maven POM 标注 MulanPSL-2.0；服务模块保留两种真实声明和原文件，不笼统宣称单一许可证。本站未使用其 Web SDK。Caffeine、Jackson、SLF4J 等许可及来源随服务模块保存。具体版本以服务 pom.xml 为准。

- [Tianai 1.5.5 稳定发布](https://github.com/dromara/tianai-captcha/releases/tag/1.5.5)
- [实际构建接口](https://github.com/dromara/tianai-captcha/blob/1.5.5/tianai-captcha/src/main/java/cloud/tianai/captcha/application/TACBuilder.java)
- [基础轨迹检查](https://github.com/dromara/tianai-captcha/blob/1.5.5/tianai-captcha/src/main/java/cloud/tianai/captcha/validator/impl/BasicCaptchaTrackValidator.java)
- [官方 Maven POM](https://repo.maven.apache.org/maven2/cloud/tianai/captcha/tianai-captcha/1.5.5/tianai-captcha-1.5.5.pom)
- [Caffeine](https://github.com/ben-manes/caffeine)

## 验证记录

2026-10-11：新滑块相关 Node 签名、绑定、持久消费与 HTTP 登录回归均通过；前端合成 DOM 覆盖拖动、键盘、尺寸变化、取消刷新、图片/请求超时、重复提交与原账号处理。TypeScript 和干净网站构建通过。Java 的 13 项 JUnit 覆盖实际核心匹配、一次性消费、缓存到期与私有 HTTP 契约，均通过，最终 jar 打包成功。

独立只读复核补验内部服务悬停 5 秒中止、750001 字节响应拒绝、第 5 个并发请求拒绝，以及验证正文超限和持续发送数据的慢速 chunked 连接 10 秒截断。检查没有发现签名伪造、跨入口登录或凭据重放绕过。

自动工具策略曾拒绝使用 PowerShell Start-Process / Stop-Process 启动并关闭打包产物的独立进程检查，只返回 blocked by policy，未说明进一步原因。没有换方式绕过；随后由项目所有者手动启动本地预览，截图确认启动成功，再对现有进程进行只读补验。

手动启动后的本地 Node 与实际打包 Java 服务已连通：读者、作者入口各抽查 4 次拼图请求均为 200，图片响应约 28–35 KB，7 次耗时为 25–31 ms，另一项为 217 ms。这些数据包含本机请求客户端开销，不能作为线上延迟承诺。两个入口无 proof 的登录均为 403，不返回会话；实际 Java 匹配错误位置为 403，重复尝试同一挑战再次为 403，不返回 proof。项目所有者人工确认读者预览拖动顺畅、验证并登录成功。

私有服务仅监听 127.0.0.1:4253。两次低负载进程快照的工作集约 93–97 MiB、私有内存约 120–123 MiB；未进行 Linux cgroup、满缓存或并发生成峰值测试。缓存复核确认只保存验证码类型和目标百分比等小型验证数据，不缓存每次响应的 Base64 或栅格。拟定的 JVM 堆与进程内存限制仍须在实际服务器补验。

上线前补验：Java 13 项 JUnit 再次通过；重复打包回归先重现旧 shaded jar 被重用的问题，修正后连续两次构建均无重叠 class 警告，最终 jar SHA-256 一致。设置 SANSPHASE_CAPTCHA_BUILD_TEST=1 后运行 tests/login-captcha-packaging.test.mjs 可复验，普通测试默认跳过需要本机 Java/Maven 的构建。

设置 SANSPHASE_UI_TEST_BROWSER 为已安装 Chromium/Edge 的路径后，tests/login-slider-browser.test.mjs 使用独立隐藏浏览器 profile，在 about:blank 加载真实滑块模块、样式和图片，覆盖读者/作者两入口、240/460px 容器、键盘/触屏 PointerEvent 模拟共 8 组。检查通过：无横向溢出、正确焦点、第二触点不干扰、取消触摸不提交、实际尺寸上报、正确入口和请求头、完成后输入与滚动位置稳定。它使用隔离的验证响应，不访问账号或线上，也不冒充实际手机及真实作者账号端到端验收。

合成 DOM 不代表真实手机人工验收；现有自动化覆盖作者界面、触控模拟和尺寸变化，但没有把它们表述为真实作者账号及全部手机型号的人工验收。以下记录补齐正式 Linux 服务与公网检查，本次没有公开推送。

2026-10-11 正式部署：主站 Java 21 服务仅监听 loopback 4253，设置 Xmx 192 MiB、MemoryMax 320 MiB、TasksMax 32，并配置开机启动。重启后 24 次、最多 4 个并发的生成检查通过，观察峰值约 84 MiB；未授权健康请求为 401。这是受控小并发检查，不冒充满缓存或无限并发容量保证。

主站生产配置仅新增 loginVerification，其他原配置与持久数据路径保持不变；Nginx 独立挑战与匹配规则已通过 nginx -t 并正式加载。隔离恢复的主站使用真实 Java 服务验证读者与作者挑战接口；公开域名上线后再次验证两种缺少 proof 的登录均被 403 拒绝，不创建账号会话。真实 Edge 公网检查可见滑块、图片解码、未验证提交禁用及取消后的输入和页面位置保持，观察期无自动重启。部署源码及两站发布验证见 SHARING-AND-INVITATIONS.md。

同日窄窗口补验发现：真实鼠标展开拼图时，浏览器滚动可能使取消按钮进入固定页头后方。已在所属滑块模块修复：图片准备完成后用原生滚动将整个面板保持在可见区域；取消时恢复原窗口和祖先滚动位置，导航离开时不干预新页面。读者页单独预留固定页头，作者窗口沿用自身滚动内边距。

修复源码 `5a975feb910790f93a8a7f0288d96a45123ea64e` 已于 2026-10-11 部署到两站，版本 `1.0.0-rc.1-47a8842221f94934`。本地实际 Edge 检查读者/作者、四种窗口、真实鼠标/键盘共 16 组，并补验刷新和取消；原有 8 组浏览器检查也通过。两台 Linux 分别完成类型检查、干净构建和 37 项相关测试，全部通过、无跳过。本次只改界面与回归用例，不将前一版全量测试描述为本补丁再次全量执行。

最终公网 Edge 以 756×488 窗口进行真实鼠标点击，无手动补滚：面板位于固定页头下，滑块与取消可直接点中；取消后滚动位置精确恢复，输入保留且焦点回到验证按钮。此次检查只申请挑战、不求解、不提交真实账号。公网读者页面和分享页检查无观察到的运行异常；实际账号登录成功的人工证据仍是此前本地演示验收。
