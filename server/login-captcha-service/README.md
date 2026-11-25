# 私有登录滑块验证服务

这是当前 Node 登录流程的本地伴随服务。Tianai Captcha 1.5.5 负责生成拼图、保留答案和验证滑动位置及基本轨迹；本模块仅做 HTTP、资源和缓存适配。它不会替代网站账号、密码校验、登录限流或持久防重放机制。

## 构建与运行

需要 Java 21 和 Maven。固定依赖通过 Maven Central HTTPS 获取，构建时启用严格校验和：

运行库固定为 Tianai 1.5.5、Caffeine 3.3.0、Jackson 2.21.7 和 SLF4J 2.0.20。版本已核实官方发布记录；Jackson 选择当前仍维护的 2.21 LTS 分支，保留其兼容的 `com.fasterxml.jackson` API，不使用已经关闭的 2.20 分支或实验版本。Caffeine 使用近期改进过期与读取行为的稳定版本。后续升级须重新执行本模块用例与完整 Node 登录链路验证，不能只替换 jar。

```sh
mvn -C test package
export CAPTCHA_SERVICE_SECRET='<独立随机生成的至少 32 字节 ASCII 密钥>'
export PORT=4253
java -Xms32m -Xmx192m -XX:ActiveProcessorCount=2 -Djava.awt.headless=true -jar target/login-captcha-service-1.0.0.jar
```

密钥通过环境变量传入，不放在命令行参数、仓库或网页。Node 应使用同一私有密钥连接这个服务。示例占位符不能作为正式密钥。Windows 使用相同环境变量和 JVM 参数。

服务地址固定 `127.0.0.1`，不能设为公网或监听全部网卡。默认端口 4253，`PORT` 可使用 1024–65535。建议由部署系统负责启动、重启和关闭，不让生产 Node 自行下载或构建 Java 依赖。生成文件 `target/` 不进入 Git；源码发布清单和实际服务器产物部署应分别验证。

## 内部接口

三个接口都必须带 `Authorization: Bearer <CAPTCHA_SERVICE_SECRET>`。密钥比较使用 SHA-256 摘要和恒定时间字节比较。返回均禁止缓存。没有公开答题、调试或代解端点，也不启用 CORS。

| 接口 | 输入 | 成功输出 |
| --- | --- | --- |
| `GET /health` | 无 | `{"ok":true}` |
| `POST /challenge` | 空 JSON 对象 `{}` | 仅 `id`、`type:SLIDER`、背景与透明模板的 data 图片和四项图片尺寸 |
| `POST /verify` | `{"id":"SLIDER_...","track":<ImageCaptchaTrack>}` | `{"verified":true}` 或 `{"verified":false}` |

`ImageCaptchaTrack` 使用 Tianai 官方 DTO：`bgImageWidth`、`bgImageHeight`、`templateImageWidth`、`templateImageHeight`、`startTime`、`stopTime`、`trackList`。每个轨迹点为 `x`、`y`、`t`、`type`，当前 Node 契约使用 `DOWN`、`MOVE`、`UP`（也接受官方 SDK 的小写形式）。可提交有边界的整数 `left` 和 `top:0`。坐标必须归一化为相对首次按下的位置。若采用官方 Web SDK，其原始绝对页面坐标需要在前端薄适配中减去首点。适配仅换坐标原点，不产生或模拟用户轨迹。

背景原图 600×360，透明模板 110×360；模板实际缺口的纵向位置已包含在透明图中，前端只横移。客户端可按页面尺寸等比例展示并提交实际显示尺寸。响应明确投影八个公开字段，排除上游 `data`、标签、目标百分比和答案坐标。

请求正文最多 40 KiB，轨迹最多 512 点，图片尺寸和数值有边界，拒绝重复字段、未知字段、非 JSON、编码正文、异常时间和非有限数。生成最多两项同时处理，HTTP 线程为两个，队列 16 项、连接 32 项，传输请求和响应期限为五秒。Node 端也需要设置自己的请求超时。

## 生命周期和安全边界

Caffeine 3.3.0 薄适配实现最多 2048 个挑战、120 秒生命周期和原子读取后删除。它替换了 Tianai 默认缓存：默认 `getAndRemoveCache` 对过期项的即时检查不能作为本项目安全边界。成功、位置错误、轨迹错误和格式错误的匹配尝试都会消耗该挑战；过期、重放和服务重启后原有挑战均失败。未知挑战不会创建新缓存项。

Node 的最终登录证明应另外绑定浏览器 nonce、站点、登录入口和到期时间，并在 SQLite 中持久记录消费，防止最终证明在 Node 重启后重放。服务认证不能代替用户级限流；必须由 Node 先做源站、请求意图和频率检查，再调用服务。服务故障或忙碌时应停止登录并允许用户重试，不可自动绕过验证。

Tianai 的 `BasicCaptchaTrackValidator` 校验服务端保留的缺口答案及基本轨迹条件。没有任何滑块可以保证只允许真人，复杂脚本和图像识别仍可能通过。不要将基本轨迹校验描述为独立的 AI 风控或绝对阻止机器人。

## 背景与许可证

16 张背景由本项目源码的 Java2D 图形绘制，启动时准备好，每次由上游资源库随机选取。它们是原创山景素材，不使用网络图片、不包含用户上传数据，也不重写验证码切割算法。后续增加背景应修改该资源模块或接入受控本地资源，保留上游生成器和验证器边界。

两个拼图模板来自 Tianai 1.5.5 的官方资源，只注册 `SLIDER` 模板，不加载或使用字体。打包排除演示背景和字体。官方仓库该标签的根许可证是 Apache 2.0，随包保留在 `licenses/tianai-captcha-APACHE-2.0.txt`；该版本发布的 Maven POM 又声明 MulanPSL2，存在上游许可证元数据不一致，应同时记录，不能将其声称为一致的单一声明。参考：

- <https://github.com/dromara/tianai-captcha/tree/1.5.5>
- <https://repo.maven.apache.org/maven2/cloud/tianai/captcha/tianai-captcha-parent/1.5.5/tianai-captcha-parent-1.5.5.pom>
- <https://license.coscl.org.cn/MulanPSL2>
- <https://github.com/ben-manes/caffeine>
- <https://github.com/FasterXML/jackson-databind>

## 验证

JUnit 通过库内部的测试夹具读取答案生成正确轨迹，仅用于测试，不存在对应 HTTP 功能。覆盖真实 Tianai 匹配、错误坐标和过快动作、过期、成功与失败的单次消费、并发只成功一次、缓存容量、公开响应不泄漏答案、接口认证、输入边界和禁止答题端点。

这些测试不等于真实鼠标、触控和键盘的浏览器验收；页面体验还需在本地预览中单独检查。
