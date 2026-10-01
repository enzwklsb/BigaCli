# 连接器调查（2026-10-01）

## 1.1.0 当前状态（2026-10-02）

以下旧调查是历史记录。当前默认通过官方 Playwright MCP 0.0.83 的扩展模式连接日常 Chrome，可在设置切换 Edge 或独立 Chromium。首次需在电脑安装扩展并允许连接；不复制浏览器凭据，不启用日常 Profile 的远程调试端口。连接器选择独立于 Codex 账号。已实际连接日常 Chrome，沿用 Google 登录进入 X，并发布一条带演示视频的英文帖子。

GitHub 区域已提供设备码授权、切换账号和退出功能，复用电脑上的 GitHub CLI。Codex CLI / SDK 当前为 0.159.3，CloudCLI 保持 1.37.3。浏览器不再提供关闭连接器的总开关，未连接扩展时普通聊天仍可启动。桌面 Computer Use 不在本版范围内。

## 浏览器实施更新

### 关闭开关导致聊天失败的修复

原停用分支只返回 `{ enabled: false }`，没有 MCP transport 所需的 command/args。已使用原生 Codex app-server 复现 `invalid transport in mcp_servers.bigacli-browser`。现移除停用开关及写入接口，忽略历史停用记录，始终提供完整工具配置；浏览器窗口仍按需启动或关闭。设置仅保留打开/登录、关闭窗口和状态查看。已验证历史停用记录下原生 Codex 能正常创建会话，三语手机页面无禁用开关。

以下调查结论保留为背景；浏览器现已在 `custom/server/modules/browser-use` 复用 CloudCLI 实现并完成以下适配：

- 默认可用，首次创建浏览器时自动下载固定版本的 Playwright Core 和 Chromium，使用安装包内置 Node，不依赖全局 npm、Chrome 或 3001。包下载校验 npm 元数据中的 SHA-512。
- Playwright 固定为 1.62.1：本机验证中 1.63.0 的 Chromium 在下载时多次访问冲突退出；1.62.1 通过同一流程。
- 使用 `.codexlite/browser-use/profiles` 独立持久 Profile，默认 `default`；可见窗口供用户手动登录，不读取现有 Chrome/Edge 凭据。相同 Profile 的并发打开复用一个会话。
- 通过 BigaCli 启动的原生 Codex `thread/start` / `thread/resume` 配置注入 `bigacli-browser` MCP。连接凭据来自服务端，不复制网站 token，不写入任何客户端的全局 MCP 配置。不同 CODEX_HOME 使用同一服务端浏览器。
- 设置 → 连接器可打开浏览器、查看准备状态、关闭浏览器及停用能力。首次准备自动执行；停用是可选项。
- 保留 CloudCLI 页面操作和标签页工具，增加文件上传、下载保存；截图以 MCP 图片返回，不把 base64 塞进文本。

已验证：隔离环境自动安装，可见浏览器打开、输入、点击、文件上传下载、关闭重开保留网站存储；两个独立 CODEX_HOME 工具进程读取同一浏览器；一次真实原生 Codex 请求调用工具并读取页面。设置页三种语言、手机宽度、操作状态及错误显示通过检查。

边界：未使用真实网站账号测试登录或发布，未消耗额度验证自动换号，也未接入现有 Chrome/Edge、桌面 Computer Use 或 GitHub 首次授权界面。部署使用小型补丁，等待当前任务结束后应用。

## 结论

Codex CLI 支持 MCP 和 Apps 连接器。浏览器/电脑控制需要额外的宿主或浏览器连接，不能从“CLI 支持连接器”推断它能接管已打开的 Chrome。此前把浏览器控制通路和应用连接器混在一起的解释不准确。

BigaCli 当前存在设置入口和集成缺口。此次先增加设置 → 连接器，读取现有 API 的真实状态和默认账号 MCP 配置，提供 Chrome 扩展指引；尚未实现 Chrome 配对、应用 OAuth、MCP 配置编辑及附加账号管理。

## 本地证据与复用边界

- 当前安装版本 1.0.2，CloudCLI 1.37.3，Codex 0.153.4；以安装目录 active.json 为准。
- `custom/server/index.js` 已挂载 `/api/browser-use`、`/api/browser-use-mcp` 和 `/api/providers`。
- `cloudcli/server/modules/browser-use/browser-use.service.ts` 启动 `headless: true` Chromium。持久化 profile 也在独立目录，未使用 Chrome 扩展、现有标签页或 `connectOverCDP`。
- 3101 的 `/api/browser-use/status` 实测：enabled=false，available=false，playwrightInstalled=false，chromiumInstalled=false。
- `/api/providers/codex/mcp/servers?scope=user` 实测正常；页面仅显示名称及传输方式，不展示环境变量、认证头等配置。
- CloudCLI MCP 路由和 Provider 可复用。其 Codex Provider 的用户配置路径固定为系统 `~/.codex/config.toml`，没有遵循 BigaCli 的 accountId/Profile Home；不能直接宣称适用于附加账号。
- 原有 `registerAgentMcp` 会调用 `addMcpServerToAllProviders`，覆盖同名 MCP 并清理旧名；不适合直接作为 BigaCli 的 Chrome 连接开关，可能影响其他客户端共享配置。
- 仓库当前未发现 CloudCLI 提供 Codex `app/list` 的应用授权管理。CloudCLI 的插件系统是它自己的扩展系统，不等于 OpenAI Apps。

## 已有 Chrome 的候选方案

微软 Playwright MCP 提供 `--extension`，支持连接已有 Chrome/Edge 标签页和登录状态。可复用它的 MCP 协议与官方扩展，无需自行开发浏览器控制协议。

后续实现应使用 BigaCli 内置 Node 和明确安装位置，按目标账号写入配置，保留浏览器扩展的配对确认，并用“读取所选标签页”验证真实连接。不能把安装成功或配置写入成功显示为已连接。当前尚未安装该扩展或验证 Chrome 连接；X 发布仍需用户审查文案后授权。

## GitHub 首次授权入口（2026-10-01）

设置 → 连接器新增 GitHub 卡片，复用本机 `gh auth login --web` 的设备授权流程。服务端使用非交互管道取得验证码，前端链接在操作者当前手机或电脑打开 GitHub 授权页；不启动服务端浏览器。凭据由 GitHub CLI 管理，不返回给页面、不复制到 Codex Profile，也不另外存入 CloudCLI Token 表。

已有登录读取 GitHub CLI 的当前有效账号。未安装 CLI 时显示官方安装链接；本轮不内置安装器。支持取消未完成授权、重复点击复用当前流程、超时重新发起。授权入口使用已有 API 身份验证。

已验证：本机现有账号识别；隔离配置取得真实 GitHub 验证码后取消，原有账号未改变；手机及桌面宽度下当前客户端打开授权页、成功状态更新与中英日布局（页面授权结果为模拟）。未替用户完成一次新的网页授权，真实最终确认仍需用户操作 GitHub 页面。

## 来源

2026-10-01 后续精简：设置 → 连接器仅保留 GitHub，删除浏览器操作、说明和 MCP 列表；浏览器工具继续默认可用。GitHub 新增已保存账号选择与切换、登录其他账号、退出所选账号。退出确认说明本机 GitHub CLI 共享登录的影响，不退出网页、不撤销远端 OAuth。使用隔离配置和虚构无效凭据验证真实 CLI 切换/退出，页面模拟验证成功状态、取消退出及手机三语布局；未改变用户实际账号。

- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Codex 配置参考：features.apps](https://learn.chatgpt.com/docs/config-file/config-reference)
- [ChatGPT Chrome 扩展](https://learn.chatgpt.com/docs/chrome-extension)
- [CloudCLI 上游](https://github.com/siteboon/claudecodeui)
- [Playwright MCP：Browser Extension](https://github.com/microsoft/playwright-mcp#browser-extension)
- [Playwright 扩展安装说明](https://github.com/microsoft/playwright/tree/main/packages/extension)
