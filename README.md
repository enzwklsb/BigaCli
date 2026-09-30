# BigaCli

BigaCli 是基于 [CloudCLI](https://github.com/siteboon/claudecodeui) 的 Codex Web 客户端，面向在手机与电脑之间持续作业的用户。任务在自己的电脑上执行，手机通过浏览器操作，重点是多账号接续、手机端完整工作流和更专注业务的沟通。

以下功能说明对应本仓库当前实现；下载的旧发行版可能尚未包含全部功能。

## 项目特色

1. **多账号之间接续作业。** 管理多个独立登录的 Codex 账号，支持多账号之间的会话接续，处理账号切换时的会话占用与历史衔接问题。用户继续留在原对话，不必手动复制上下文。
2. **额度耗尽后继续工作。** 可自动切换符合条件的账号，或等待额度恢复后自动继续；支持恢复多个因额度耗尽而暂停的对话。等待期间仍可输入和排队。
3. **简洁、专注业务的沟通。** 全局预设规约引导 Agent 先讲结果、减少无关技术细节，以最小充分修改完成任务；设置中的简洁回复控制回答详略。
4. **手机端文件预览与下载。** 支持图片、PDF、HTML、Markdown、文本等格式的预览和下载，并提供当前对话文件入口，便于在手机上检查和取走成果物。
5. **手机与电脑共用工作入口。** 两端访问同一服务，共享会话与任务状态。电脑服务和网络连接保持可用时，可直接重新打开网址，无需每次重新进行应用层配对。
6. **可编辑的消息队列。** 作业中可选择立即发送或排队；排队消息可以预览、实时修改、删除或单独立即发送，编辑期间不会被自动发出。
7. **在手机上直接重置额度。** 不必回到电脑，就能查看剩余重置次数及到期时间，并在二次确认后消耗一次机会重置额度。额度查看、切号、等待恢复和重置都在同一手机工作流中完成；重置能力取决于账号实际提供的机会。
8. **消息时间留痕。** 显示消息时间、处理过程及可获得的耗时信息，便于回看长任务和跨时段作业。
9. **输入与附件草稿保留。** 支持上传和粘贴文件，保留文字与已保存的待发送附件草稿，刷新页面后可继续编辑。

## 启动与手机连接

从 [最新发行版](https://github.com/enzwklsb/BigaCli/releases/latest) 下载 **BigaCli-win-x64.zip** 完整 Windows 安装包，解压到可写目录，运行 `start.cmd`。在电脑浏览器打开 `http://localhost:3101`，添加 Codex 账号并选择项目、对话。首次使用需要自己的 Codex 账号；安装包不包含任何登录信息。

后续在「设置 → 检查更新」获取新版本。点击「下载并更新」后会等待正在运行的任务结束再切换版本。首次安装只需完整 ZIP，其余组件 ZIP 和 `release.json` 由更新器使用，无需手动下载。

**BigaCli 本身不提供手机与电脑之间的网络穿透功能。跨网络访问推荐使用 [Tailscale](https://tailscale.com/download)。** 每个用户自行连接自己的设备，不需要加入作者的网络，也不依赖作者提供的连接服务器。

- 同一局域网：手机访问 `http://电脑的局域网IP:3101`。
- 跨网络：在电脑和手机上安装 Tailscale，登录自己的同一账号并连接；手机访问 `http://电脑的Tailscale-IP:3101`，可收藏该地址。
- 电脑需要保持开机、联网并运行 BigaCli；服务监听和防火墙必须允许相应网络访问。

BigaCli 页面当前不设置独立的网页登录认证，能够连接服务的设备即可操作。请在自己的可信局域网或 Tailscale 私有网络中使用，不要将 3101 端口直接开放到公网。Codex 账号登录与此独立。

## 界面入口说明

| 位置或标志 | 用途 |
| --- | --- |
| 左上角菜单 | 打开侧边栏，浏览项目工作树和最近对话。 |
| 侧边栏顶部搜索框 | 搜索项目、对话及正文，定位历史内容。 |
| 项目工作树旁的「新建」 | 创建工作树；项目下的「新建对话」用于开始新会话。 |
| 对话旁的三点菜单 | 重命名、复制 Codex 会话 ID、分叉到副本继续、归档或永久删除。 |
| 侧边栏底部账号区域 | 打开「账号」或「设置」。 |
| **右上角文件夹图标** | **打开当前对话文件列表，查看当前对话产生或涉及的文件**，按文件名或格式搜索，点击文件预览和下载；不是整个电脑的文件管理器。 |
| 消息中的文件卡片／图片缩略图 | 打开对应附件预览；预览窗口顶部的「下载」保存文件。 |
| 输入框左下角「＋」 | 添加图片或文件；也支持直接将剪贴板中的文件粘贴到输入框。 |
| 输入框仪表盘图标 | 打开当前账号额度面板，查看额度、恢复时间、重置次数及到期时间，执行重置或进入切号页面。 |
| 输入框模型名称 | 选择模型、思考深度和可用的快速模式。选项以当前账号实际支持的能力为准。 |
| 输入框盾牌／警告图标 | 选择默认、编辑或无限制权限模式；无限制模式使用红色警告图标。 |
| 输入框右侧发送／停止按钮 | 发送新消息，或停止当前任务；作业中发送内容时可选择排队或立即发送。 |
| 输入框内的排队列表 | 显示每条排队消息的首行。点击打开编辑，再点同一行或点外部关闭；右侧 × 删除该条。超过三行可滚动。 |
| 输入框上方的额度恢复条 | 显示等待额度恢复的倒计时，可取消自动继续；取消后通过「预约」重新开始等待。 |
| 额度耗尽提示卡片 | 查看恢复时间、重置机会和最近到期时间，选择切换账号恢复或重置额度。 |
| 设置 → 报告问题 | 填写并直接提交反馈，无需登录 GitHub。失败保留文字；反馈进入维护者的私有列表。 |

## 常用操作

### 多账号与额度恢复

在「账号」页面添加、选择或移除账号；额度面板中的切号图标也打开同一账号页面。任务运行中不能直接改变其账号环境。

普通账号页面手动切换只改变账号选择，不自动恢复中断任务。从额度耗尽卡片进入「切换账号恢复」，则按恢复流程接续任务。开启「额度耗尽时自动切换」后，系统在符合条件时自动选择有额度且支持当前模型与思考深度的账号。

没有可切换账号时，默认等待当前账号恢复额度；账号列表提示最早恢复的候选账号，也可选择其他账号等待。自动继续以恢复时间加一分钟为预约时间，并再次检查额度。可随时取消，等待期间输入框仍然可用。

5h 或 7d 任一受限窗口耗尽，账号即不可用于继续作业；成功获取额度且未返回 5h 限制时显示「无限制」，请求失败或异常时显示「未知」。手机端可在额度面板查看重置机会，点击「重置」后还需确认，不会仅点开按钮就消耗次数。

### 排队与立即发送

「排队发送」在当前任务结束后发出。多次排队会合并成一次补充消息，使用第一条排队消息保存的模型与思考深度；之后更改设置用于后续新发送。

点击队列只打开预览，不自动唤起键盘。编辑实时保存；编辑窗口打开期间，队列即使已满足发送条件也会等待关闭后再发出。编辑窗口底部的「立即发送」只发送当前这一条，其余继续排队。等待额度恢复时，「立即发送」不可用，但可以继续添加排队消息。

额度恢复后先继续被中断的任务，完成后再发送排队内容，包括排队中的纠正或补充。主动停止当前任务后，有额度且未处于编辑等待等状态时，保留的队列可以接着发送。

### 文件与草稿

输入框中的附件卡片右上角 × 用于移除待发送附件；它与已发送消息中的文件预览入口不同。文字和附件草稿的刷新恢复不等于将未发送内容实时同步到另一台设备。

预览能力以实际格式为准，不支持预览的文件仍可下载。文件预览、下载和右上角当前对话文件列表均面向电脑与手机浏览器。

### 设置

界面支持简体中文、English、日本語及深色模式。界面语言控制按钮和提示文案，不作为强制 Agent 回复语言的指令；用户可在对话中明确指定回复语言。

「简洁回复」从下次发送生效，切号后沿用。思考摘要和工具详情开关只控制页面显示，不改变任务执行或权限确认。设置底部保留版本与检查更新入口。

## 仓库导航（开发者与 Agent）

| 路径 | 职责 |
| --- | --- |
| `AGENTS.md` | 仓库协作、修改与交付约定，改代码前先阅读。 |
| `ui/index.html` | 主界面、弹窗、输入与队列交互、账号与额度入口。 |
| `ui/locales.json`、`ui/i18n.js` | 中英日文案及界面语言切换。 |
| `ui/preview-ui.js`、`ui/vendor/` | 文件预览相关逻辑和依赖。 |
| `custom/server/modules/providers/` | Codex 运行、账号隔离、切号接续、额度与中断恢复。 |
| `custom/server/modules/scheduled-messages/` | 排队消息及调度。 |
| `custom/server/modules/websocket/` | 实时消息与跨端会话订阅。 |
| `feedback/` | Cloudflare Worker 反馈接口、D1 建表与部署说明；自行部署参见 `feedback/SETUP_CN.md`。 |
| `cloudcli/` | 固定版本的上游源码。 |
| `scripts/` | 构建、验证及交付脚本。 |

手机连接依赖用户自己的网络配置；反馈接收服务与手机连接电脑是两个独立功能。自行部署反馈服务时，需将页面提交地址改为自己的服务地址。

## Build and release

Windows x64 and Node 24.19.0 are used for release builds. In `cloudcli/`, run `npm ci` then `npm run build`. At the repository root run `node scripts/build.mjs`, then `scripts/package.ps1 -NodeDirectory <directory-containing-node.exe>`. The packaging shell must use that Node version on PATH, with npm available for build-time dependency installation.

`release.json` pins our release and upstream versions; `cloudcli/package-lock.json` records exact dependencies. `cloudcli/` contains upstream source, while `custom/server/` is the readable source of customized runtime modules and `ui/` is our page source. The build compiles upstream and copies customized modules into their original locations. Changes should be maintained in these source directories, never patched into installed releases.

`nodeArchive` pins an already published Node component by URL and SHA-256. Reuse that archive while Node stays unchanged, so differences between compression tools cannot force a redundant client download. When changing Node, build and publish the new component and update this pin. For local rebuilds, `-ReuseDependencies` may reuse the dependency archive only when the lockfile has not changed.

The release workflow produces a **draft** release. Review it and publish it to make the update visible to installed users. Application, production dependencies and Node are separate complete component ZIPs. One release manifest selects the tested combination. This supports skipping releases without sequential patch installation.

For application-only updates, `-ComponentsOnly -ReuseDependencies` packages the app and reuses the unchanged component archives placed in the new version's assets directory. It does not rebuild a full installation ZIP. Downloads happen in the desktop launcher under `<install>/downloads`; successfully extracted components live under `<install>/store`, and temporary ZIPs are removed.

## Data and licensing

Do not place authentication files, personal databases or session histories in this repository or release assets. The default Codex home remains the user's existing `.codex`; additional account homes are isolated. This release keeps the existing CloudCLI application database and account-store locations so the bootstrap installation retains its data during the update.

Based on [CloudCLI](https://github.com/siteboon/claudecodeui), licensed under **AGPL-3.0-or-later**. BigaCli modifications are released under the same license. The exact corresponding source and build scripts are available at each release tag. Upstream notices are retained under `cloudcli/NOTICE`; bundled third-party packages retain their respective licenses. This software is provided without warranty.
