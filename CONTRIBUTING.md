# 开发指南

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | >= 20 | 用到 `structuredClone` 等 API |
| pnpm | 12.x | 仓库只维护 `pnpm-lock.yaml`，npm / yarn 会装出不一样的依赖树 |

```bash
corepack enable          # 让 node 自动使用 package.json 里声明的 pnpm 版本
pnpm install
```

`.npmrc` 里关掉了「被忽略的构建脚本视为错误」（`strict-dep-builds=false`），
因为 esbuild 的二进制由 vite 自带，跳过它的构建脚本不影响使用。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动扩展开发模式（@crxjs 热更新），产物写进 `packages/extension/dist` |
| `pnpm build` | 构建扩展（生产模式） |
| `pnpm bundle` | 构建 + 打包成 `ugaeo-v<version>.zip`（根目录） |
| `pnpm test` | 跑 core 与 extension 的全部单元测试 |
| `pnpm typecheck` | 两个包的类型检查 |
| `pnpm lint` | ESLint |
| `pnpm version:check` | 校验 7 处版本号是否一致 |
| `pnpm version:bump patch` | 统一升级版本号（`patch` / `minor` / `major` 或直接给版本） |

## 目录结构

```
packages/
├── core/                 平台适配器的唯一真源（不含浏览器 API）
│   └── src/adapters/
│       ├── platforms/    每个平台一个文件
│       ├── platform-profiles.ts   内容形态 + 分组排序
│       ├── page-publish.ts        页面驱动发布基类
│       └── __tests__/adapter-consistency.test.ts   一致性体检
├── extension/            MV3 扩展本体（popup / 控制台 / content script / background）
├── cli/                  命令行工具
└── mcp-server/           MCP 服务，供 Claude 等 AI 工具调用
```

## 在浏览器里调试

```bash
pnpm dev
```

1. 打开 `chrome://extensions`，开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选 `packages/extension/dist`
3. 改代码后扩展会自动重新构建，**但扩展本身需要点一次「重新加载」**

> Chrome 137+ 已禁止 `--load-extension` 命令行参数，只能手动加载 dist 或拖入 zip。

## 新增一个平台

这是最常见的贡献方式，按顺序做，缺一步就会出现「代码里有、界面没有」或「标签写错」。

1. **写适配器**：`packages/core/src/adapters/platforms/<id>.ts`
   - 有官方 API → 继承 `CodeAdapter`
   - 只能靠网页 → 继承 `PagePublishAdapter`，并在 `pageConfig` 里给出 `mode`（`editor` 能自助发布 / `submission` 只能人工提交）
   - 只能投稿没有后台 → `requiresAuth = false`，此时必须返回 `authMode: 'public'`，界面才会显示「无需登录」而不是「已登录」
2. **注册**：加进 `packages/core/src/adapters/platforms/index.ts` 的 `BUILT_IN_ADAPTERS`
   （扩展和测试共用这一份清单，漏加会直接被一致性测试拦住）
3. **打档案**：在 `platform-profiles.ts` 的 `PLATFORM_PROFILES` 里补 `{ kind: 'graphic' | 'news', order: number }`
4. **跑测试**：`pnpm test`，`adapter-consistency.test.ts` 会校验：
   - 档案与适配器一一对应
   - `editorUrlMatch` 必须出现在 `editorUrl` 里
   - 需要登录的平台必须给出 `sessionCookieNames`
   - 投稿型不得声明 `publish` 能力
5. **补文档**：README 平台表 + `docs/平台分类.md`
6. **真机验证**：点开同步一次，确认标题/正文/发布按钮都能命中。选择器是按当时页面写的，平台改版后会失效，自检页的「深度体检」能快速发现。

### 不想公开某个适配器

放进 `packages/core/src/adapters/platforms/private/`，扩展会用 `import.meta.glob` 自动加载，
该目录已在 `.gitignore` 里 —— 但**不要**把 `index.ts` 静态 import 的文件加进忽略列表，
否则别人 clone 后构建会直接失败。

## 提交规范

Conventional Commits，正文中文可以，前缀用英文：

```
<type>(<scope>): <描述>

type:  feat | fix | chore | docs | refactor | test | perf | ci | style
scope: 包名或平台 id，如 core / extension / zhihu / wechat
```

例：

```
fix(eastmoney): UserInfo4jsonp 补齐 deviceid 与 product=CFH
feat(platform): 新增 InfoQ 中文站投稿入口
docs: 补充平台分类与登录态判定说明
```

## 提交前必须通过

```bash
pnpm version:check && pnpm typecheck && pnpm test
```

改了界面或发布逻辑的，再跑一次 `pnpm bundle`，把 zip 装进浏览器确认版本号与功能正常。
CI 会跑同样的检查，但本地先过能省一轮等待。

## 文档索引

- [安装与使用](docs/安装与使用.md)
- [平台分类与准入](docs/平台分类.md)
- [平台自检](docs/平台自检.md)
- [适配器开发规范](docs/adapter-spec.md)
- [开源发布清单](docs/开源发布清单.md)
