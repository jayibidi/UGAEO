# UG·AEO | 新媒体中心

![](https://img.shields.io/github/v/release/jayibidi/UGAEO.svg)
![](https://img.shields.io/github/last-commit/jayibidi/UGAEO)
![](https://img.shields.io/github/issues/jayibidi/UGAEO)

**开源免费**的跨平台文章同步工具 | Chrome 浏览器扩展 | 自媒体内容分发神器

一键同步微信公众号文章到知乎、头条、掘金、小红书、CSDN 等 34 个平台，支持 WordPress / Typecho 等自建博客，告别重复复制粘贴。

> 🔥 支持 **Anthropic MCP 协议**，可在 Claude Desktop / Claude Code 中通过 AI 一键发布文章

## 工作原理

**文章同步助手不是爬虫，不模拟登录，不经过任何第三方服务器。**

它是一个 Chrome 浏览器扩展，工作方式与浏览器本身一致：

1. **使用你自己的登录态**：你在浏览器里正常登录各平台账号，扩展直接使用浏览器中已有的 Cookie，无需额外授权，无需输入密码
2. **调用平台官方接口**：发布文章时，扩展调用的是各平台 Web 编辑器使用的同一套官方 API，与你手动在网页上发布完全等价
3. **数据不离开你的设备**：所有请求直接从你的浏览器发往各平台，没有中间服务器，没有数据上传，源代码完全开源可审计
4. **草稿优先**：默认将文章同步为草稿，发布前由你人工确认，不会自动发布

```
你的浏览器（已登录各平台）
    ↓  扩展读取 Cookie
    ↓  调用平台官方 Web API
各平台（知乎 / 掘金 / 头条 / ...）
```

## 功能特性

- **一键批量发布**: 微信公众号文章同步到知乎、掘金、头条、CSDN、简书、微博、小红书等 34 个平台，其中 16 个可自动点下发布按钮
- **网页转 Markdown**: 任意网页智能提取正文，自动过滤广告噪音，图片本地化，打包为 Markdown + 图片 ZIP 压缩包
- **自建站支持**: WordPress、Typecho、博客园 (MetaWeblog API)
- **智能提取**: 自动从网页提取文章标题、内容、封面图（基于 Safari 阅读模式）
- **图片自动上传**: 自动转存文章图片到目标平台，无需手动处理
- **草稿模式**: 同步后保存为草稿，方便二次编辑后发布
- **自动发布**: 支持「立即发布 / 存为草稿 / 定时发布」三种模式，可按平台单独覆盖
- **发布后状态追踪**: 知乎、掘金发布后自动轮询审核状态（审核中 / 已发布 / 未通过）
- **AI 增强**: 接入 OpenAI 兼容中转站，支持标题优化、摘要、标签推荐、润色/扩写/精简、多平台风格改写
- **独立 WEB 控制台**: 点「同步」进入完整网页，集中查验多账号登录态、查看同步失败明细、发布失败一键返回编辑重发
- **AI 集成**: 支持 Anthropic MCP / Claude Code Skill / OpenClaw，多种方式接入 AI 工作流

## 自动发布与 AI 增强

### 发布模式

设置 → 发布模式：

| 模式 | 行为 |
|-----|------|
| 存为草稿 | 默认，仅创建草稿 |
| 立即发布 | 同步时直接公开发布 |
| 定时发布 | 入队，N 分钟后由浏览器自动执行 |

- 支持**按平台覆盖**：没有声明 `publish` 能力的平台会自动降级为草稿，并在结果里标注「该平台暂不支持自动发布，已保存为草稿」
- 已实现真正公开发布的平台：**知乎、掘金、CSDN、博客园、WordPress、Typecho、MetaWeblog**
- **小红书、头条号**通过「页面驱动」发布：平台 Web 接口带 `_signature` / `x-s` 等反爬签名，只能在页面上下文生成，因此扩展会打开（或复用）创作者编辑器，在页面里填入标题与正文，再触发平台的发布按钮：
  - 检测到成功反馈 → 记为已发布
  - 已点击但无法确认 → 记为「已提交」，提示去平台确认
  - 找不到发布按钮（页面改版 / 未登录） → 内容留在编辑器，按草稿返回并给出编辑器链接
  - 小红书要求至少一张图，会自动上传正文图片；一张都传不上去时只填充内容并提示手动补图
- 其余平台（微博、B 站等）仍走草稿，后续可在对应适配器补充 `publish` 能力

### 发布后审核状态

知乎、掘金的「发布成功」只代表提交成功，文章还要过审才公开。扩展会在发布后按 5 秒间隔轮询文章状态（最长 30 秒，遇到确定结果立即返回）：

| 状态 | 展示 |
|-----|------|
| `published` | 已发布，文章已公开 |
| `reviewing` | 已提交，平台审核中 |
| `rejected` | 审核未通过（会带上平台给出的原因） |

轮询超时会如实显示「审核中」，不会把未确认的状态当成已发布。单平台同步结果里会有「审核中 / 未过审」标记。

### AI 接入

设置 → AI 模型：

1. **API 地址**默认 `https://api.ugooto-ai.com/v1`（任意 OpenAI 兼容中转站均可）
2. 填写 **API Key**（仅保存在 `chrome.storage.local`，不会上传）
3. 点「拉取模型」从 `/v1/models` 选择模型，也可手填模型名
4. 点「测试连接」验证
5. 可按需开关：标题优化 / 摘要生成 / 标签推荐 / 平台风格适配

同步对话框里的「AI 助手」面板可直接使用这些能力；选择「适配 N 个平台」会为每个平台生成差异化 Markdown，同步时优先使用该版本（`platformContents`），其余平台仍走原有 DOM 预处理。

**正文加工**：面板里另有「润色 / 扩写 / 精简」三个动作，针对当前正文做通用写作层面加工（不换平台调性），结果可一键「采用为正文」。采用后原有平台适配结果会被清空，避免同步时用回旧内容。

## WEB 控制台

扩展弹窗点「同步」不再原地弹小窗，而是打开独立网页控制台（`src/console/index.html`），当前文章与已选平台会一起交接过去。弹窗顶部的「控制台」按钮可随时进入。

| 页面 | 用途 |
|-----|------|
| 概览 | 登录平台数、近 7 天同步与失败统计、最近同步、未登录平台快捷入口 |
| 同步 | 文章预览 / 编辑、平台勾选、草稿或立即发布、实时进度与逐平台结果 |
| 账号 | 每个平台真实的登录态（点「重新检测」按平台实测 Cookie）、去登录、自建站点连接测试与删除 |
| 记录 | 每次同步的完整明细，含审核状态、失败原因、草稿链接 |
| 失败处理 | 聚合近 1/7/30 天失败，按平台与类型（登录问题 / 发布问题）筛选，可「重试」「返回编辑」「去登录」 |

失败后可**返回编辑**：控制台会按 `syncId` 读取正文快照（最多保留 10 份），在弹窗里改标题、摘要、标签、正文（Markdown / HTML 可切换），再选择平台重新发布；重发结果直接显示成功或失败原因。

账号密码、Cookie、文章快照都只存在浏览器本地（`chrome.storage.local`），控制台不会向任何服务器上传数据。

## 安装

**方式一：下载 Release（推荐）**

1. 打开 [最新 Release](https://github.com/jayibidi/UGAEO/releases/latest)，下载 `ugaeo-v2.4.2.zip`
2. 解压到**固定目录**（别放下载临时文件夹，Chrome 会记住这个路径）
3. 打开 `chrome://extensions` → 右上角开启「开发者模式」→「加载已解压的扩展程序」→ 选解压出的目录

> Chrome 137+ 已移除 `--load-extension` 命令行参数，只能按上面的方式加载。
> 本扩展尚未上架 Chrome 应用商店：上架需要开发者账号与单独的隐私说明，属于独立流程。

**方式二：从源码构建**

```bash
pnpm install
pnpm bundle        # 产出根目录 ugaeo-v2.4.2.zip
```

支持 Chrome / Edge / 360 / QQ 等 Chromium 内核浏览器（116+）。

## 支持的平台

共 **34 个平台**，按「能不能替你把发布按钮点下去」分成两层。这个分层由适配器的 `capabilities` 声明推导，不是文档里手写的：

### 可直发（16 个）

16 个平台能自动完成「填入内容 → 点击发布」，失败时会明确告诉你卡在哪一步。

| 平台 | ID | 内容形态 | 发布方式 |
|---|---|---|---|
| 网易号 | `netease` | 资讯类 | 页面填充后点发布 |
| 企鹅号 | `tencent-om` | 资讯类 | 页面填充后点发布 |
| 简书 | `jianshu` | 图文类 | 页面填充后点发布 |
| 什么值得买 | `smzdm` | 图文类 | 页面填充后点发布 |
| 36氪 | `kr36` | 资讯类 | 页面填充后点发布 |
| 虎嗅 | `huxiu` | 资讯类 | 页面填充后点发布 |
| 界面新闻 | `jiemian` | 资讯类 | 页面填充后点发布 |
| 顺企网 | `shunqi` | 资讯类 | 页面填充后点发布 |
| 八方资源网 | `bafang` | 资讯类 | 页面填充后点发布 |
| 黄页88 | `huangye88` | 资讯类 | 页面填充后点发布 |
| CSDN | `csdn` | 图文类 | 官方接口 |
| 博客园 | `cnblogs` | 图文类 | 官方接口 |
| 头条号 | `toutiao` | 资讯类 | 页面填充后点发布 |
| 小红书 | `xiaohongshu` | 图文类 | 页面填充后点发布 |
| 掘金 | `juejin` | 图文类 | 官方接口 |
| 知乎 | `zhihu` | 图文类 | 官方接口 |

### 仅草稿（18 个）

18 个平台只能把内容放进草稿箱或投稿框，需要你再去后台确认一次。**这不是缺陷** —— 这些平台要么没有开放发布接口，要么发出去就等于绕过人工审核。

| 平台 | ID | 内容形态 | 发布方式 |
|---|---|---|---|
| IT之家 | `ithome` | 资讯类 | 公开投稿入口，无需登录 |
| InfoQ 中文站 | `infoq` | 资讯类 | 公开投稿入口，无需登录 |
| 快懂百科 | `kuaidong` | 图文类 | 公开投稿入口，无需登录 |
| 百度知道 | `baiduzhidao` | 图文类 | 投稿表单，需人工提交 |
| 51CTO | `51cto` | 图文类 | 官方接口 |
| 东方财富 | `eastmoney` | 资讯类 | 官方接口 |
| 人人都是产品经理 | `woshipm` | 图文类 | 官方接口 |
| 哔哩哔哩 | `bilibili` | 图文类 | 官方接口 |
| 开源中国 | `oschina` | 图文类 | 官方接口 |
| 微信公众号 | `weixin` | 图文类 | 官方接口 |
| 微博 | `weibo` | 资讯类 | 官方接口 |
| 思否 | `segmentfault` | 图文类 | 官方接口 |
| 慕课手记 | `imooc` | 图文类 | 官方接口 |
| 搜狐号 | `sohu` | 资讯类 | 官方接口 |
| 百家号 | `baijiahao` | 资讯类 | 官方接口 |
| 语雀 | `yuque` | 图文类 | 官方接口 |
| 豆瓣 | `douban` | 图文类 | 官方接口 |
| 雪球 | `xueqiu` | 资讯类 | 官方接口 |

> 平台清单以 `packages/core/src/adapters/platforms/index.ts` 的 `BUILT_IN_ADAPTERS` 为准。
> `pnpm test` 会校验适配器与平台档案一一对应；新增平台必须同步本表与 [docs/平台分类.md](docs/平台分类.md)，否则 CI 会失败。


## CLI 命令行工具

最简单的使用方式，无需配置 MCP，安装即用：

```bash
npm install -g @ugaeo/cli
```

需要先安装 Chrome 扩展并在扩展设置中启用「MCP 连接」获取 Token，然后：

```bash
export UGAEO_TOKEN="你的token"

# 同步文章到多个平台
ugaeo sync article.md -p zhihu,juejin,csdn

# 查看平台登录状态
ugaeo platforms --auth

# 从浏览器当前页面提取文章
ugaeo extract -o article.md
```

### Claude Code Skill 集成

安装后可在 Claude Code 中直接用自然语言操作：

```bash
/plugin marketplace add jayibidi/UGAEO
/plugin install sync@ugaeo
```

然后直接说"把这篇文章同步到掘金和知乎"即可。

### OpenClaw 集成

本仓库自带 `skills/` 与 `.claude-plugin/`，可以直接作为插件源注册：

```bash
/plugin marketplace add jayibidi/UGAEO
/plugin install sync@ugaeo
```

详细文档见 [packages/cli/README.md](packages/cli/README.md)

## Claude Code / Claude Desktop 集成 (Anthropic MCP)

通过 Anthropic MCP 协议，可以在 Claude Code 或 Claude Desktop 中使用 AI 同步公众号文章到多个平台。

### 配置步骤

1. 构建项目: `pnpm build`
2. 在 Chrome 扩展设置中启用「MCP 连接」，并设置 Token
3. 在 `~/.claude/claude_desktop_config.json` 中添加配置：

```json
{
  "mcpServers": {
    "sync-assistant": {
      "command": "node",
      "args": ["/path/to/UGAEO/packages/mcp-server/dist/index.js"],
      "env": {
        "MCP_TOKEN": "your-secret-token-here"
      }
    }
  }
}
```

**重要**: `MCP_TOKEN` 必须与 Chrome 扩展中设置的 Token 一致。

### 使用示例

```
"帮我把这篇文章同步到知乎和掘金"
"检查下哪些平台已登录"
```

### 可用工具

| 工具 | 说明 |
|-----|------|
| `list_platforms` | 列出所有平台及登录状态 |
| `check_auth` | 检查指定平台登录状态 |
| `sync_article` | 同步文章到指定平台（草稿） |
| `extract_article` | 从当前浏览器页面提取文章 |
| `upload_image_file` | 上传本地图片到平台 |

详细文档见 [packages/mcp-server/README.md](packages/mcp-server/README.md)

## 网页发起同步

如果你是文章编辑器开发者，或有内容库需要同步多个渠道，页面注入的 `window.syncPost` 可以直接拉起同步面板：

```javascript
// 拉起同步任务框
window.syncPost(article)
```

## 开发

### 项目结构

```
UGAEO/
├── packages/
│   ├── extension/     # Chrome 扩展 (MV3)
│   ├── mcp-server/    # MCP Server (stdio/SSE)
│   ├── cli/           # 命令行工具
│   └── core/          # 核心逻辑 (共享)
```

### 本地开发

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build
```

然后在 Chrome 中加载 `packages/extension/dist` 目录。

## 更新日志

完整变更见 [CHANGELOG.md](CHANGELOG.md)，可下载的版本见 [Releases](https://github.com/jayibidi/UGAEO/releases)。

## 参与贡献

- [开发指南](CONTRIBUTING.md)：环境要求、常用命令、如何新增一个平台、提交规范
- [适配器开发规范](docs/adapter-spec.md)
- 想支持某个平台？用 [「请求支持新平台」](https://github.com/jayibidi/UGAEO/issues/new?template=platform_request.yml) 模板提 issue，写清入驻门槛比写平台名有用得多

## 使用场景

- **自媒体运营者**: 公众号文章一键同步到知乎、头条、百家号等多平台，提升内容分发效率
- **技术博主**: 技术博客同步到掘金、CSDN、SegmentFault、开源中国等技术社区
- **内容创作者**: 告别重复复制粘贴，一次编写多处发布，多平台发文不再繁琐
- **AI 写作用户**: 配合 Claude / GPT 等 AI 写作工具，AIGC 内容一键发布到多平台
- **独立博主**: WordPress、Typecho 博客文章同步到各大自媒体平台引流

## 常见问题

**Q: 这是什么工具？**

文章同步助手是一款开源免费的 Chrome 浏览器扩展，帮助自媒体作者、博主、内容创作者将文章一键同步到多个平台，避免重复复制粘贴，是自媒体运营必备的多平台发文工具。

**Q: 支持同步微信公众号文章吗？**

支持。可以直接从微信公众号编辑器提取文章，一键同步到知乎、头条、掘金等 34 个平台。支持公众号文章同步到头条号、公众号同步到知乎、微信文章同步到掘金等各种场景。

**Q: 支持 AI 写作工具吗？**

支持 Anthropic MCP 协议，可配合 Claude Desktop、Claude Code 等 AI 工具使用，实现 AI 写作、AIGC 内容一键发布。也可以配合 ChatGPT、GPT-4 等工具生成的文章使用。

**Q: 数据安全吗？会上传我的账号信息吗？**

不会。所有操作在本地浏览器内完成，你的 Cookie、文章内容、账号信息不经过任何第三方服务器。代码完全开源，可自行审计：[查看源码](https://api.ugooto-ai.com)

**Q: 和微小宝、新媒体管家、简媒、蚁小二有什么区别？**

文章同步助手是**开源免费**的，代码完全公开透明，无需付费订阅。作为浏览器扩展运行，数据本地存储，账号信息不上传，支持 MCP 协议可与 AI 工具集成。

**Q: 如何同步文章到多个平台？**

1. 安装 Chrome 浏览器扩展
2. 登录各平台账号（知乎、掘金、头条等）
3. 打开要同步的文章页面
4. 点击扩展图标，选择目标平台，一键同步

## License

[GPL-3.0](LICENSE)。

本项目是 [Wechatsync](https://github.com/wechatsync/Wechatsync)（同样以 GPL-3.0 发布）的衍生作品，
上游版权归 Wechatsync contributors 所有，详见 [NOTICE](NOTICE)。

## 隐私

没有后端。文章内容、平台 Cookie、账号信息只存在本机 `chrome.storage.local`，
所有请求由浏览器直接发往各内容平台的官方域名。唯一的自建服务是你的控制台页面与 AI 中转站，
只有在你主动点击 AI 功能时才会把正文发出去。
