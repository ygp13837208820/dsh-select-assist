# 改造说明（v0.12.0）

基线：[`germyGao/dsh-select-assist`](https://github.com/germyGao/dsh-select-assist) v0.9.0（MIT）。
本目录是它的 fork，把「固定四项的划词菜单」改造成**数据驱动的技能栏**：技能可增删、可拖拽排序，
前 N 个常驻浮条、其余收进「更多」下拉，自定义技能用提示词模板执行。

v0.12 借了 PopClip / TextGo / 圈选助手这一类划词工具的两条共同习惯（浮窗会自己收、搜索在窗内出答案），
修掉本机两个实际问题：

- **「AI 搜索」不再是静默失败**。原来点它是"打开搜索页"，但宿主环境起不了浏览器（ego lite 一启动就
  crashpad 自杀、系统默认处理器是豆包），`spawn` 又返回成功，于是用户看到"点了没反应"。现在：
  - 默认菜单里的 `sk_ai_search` 是一条**提示词技能**：伴生进程先请求必应 RSS（6 条，3 次重试 +
    相关性校验，无关内容判成没搜到），把结果塞进 `{{context}}` 交给模型，答案流式落在回答窗，
    面板标「已联网搜索 N 条」；
  - 老的内置 `action: search` 保留兼容：先开面板，打开成功/失败都写在面板里（失败附可复制的链接），
    默认配置里已停用；
  - Markdown 链接在面板里画成「标题（域名）」，不再把整条 URL 挤进正文；复制仍拿完整原文。
- **回答窗会自己收起**。原来只有点 ✕ 才会消失，现在：
  - 结果出来后才计时，默认 15 秒，按回答长度放宽（每字 +15ms，最多 +15 秒），页脚显示「N 秒后关闭」；
  - 标题栏多一个**钉住**（钉住后不计时、Esc 与点到别处也不收，页脚显示「已钉住」）；
  - `Esc` 收起、点到别处收起；滚轮/点按钮把倒计时推回满格；
  - 配置写在 `%DSH_HOME%/dsh-select-assist.panel.json`（宿主设置页保存不会覆盖它），
    另有 `DSH_SELECTION_PANEL_TIMEOUT_MS` / `DSH_SELECTION_PANEL_AUTOCLOSE` / `DSH_SELECTION_PANEL_OUTSIDE`。
- 新增 3 个单测文件覆盖：`test/panel-config.test.mjs`（默认值/夹取/BOM/环境变量/长文放宽）、
  `test/search-web.test.mjs`（RSS 解析、CDATA、重试、相关性校验、空查询）、以及 `panel-zone` 里的
  四按钮布局与链接化简。`/status` 多报 `lastSearch` 与 `panel.autoCloseAt / pinned / config`，
  排障时能看出"这次搜没搜到、走的哪条路"。

---

# 改造说明（v0.11.1）

基线：[`germyGao/dsh-select-assist`](https://github.com/germyGao/dsh-select-assist) v0.9.0（MIT）。
本目录是它的 fork，把「固定四项的划词菜单」改造成**数据驱动的技能栏**：技能可增删、可拖拽排序，
前 N 个常驻浮条、其余收进「更多」下拉，自定义技能用提示词模板执行。

v0.11：浮条停留时长可配（默认 3.6s → **10s**，2–60s），鼠标停在浮条上不计时；
顺带修掉一个 BOM 导致设置整份失效的坑。

v0.11.1：**链接速读**。选中整段就是一个 `http(s)` 链接时，伴生进程先把页面抓下来当 `{{context}}`，
模型才可能「真的读到网页」；拒绝本机/内网地址、8s 超时、正文上限 4000 字符。

v0.11.2：**搜索地址可配**。「AI 搜索」不再写死必应，默认打开秘塔（`https://metaso.cn/?q=%s`）；
设置页多一个「搜索地址」输入框，模板里的 `%s` 会被替换成 URL 编码后的选中文字。

v0.11.3：**搜索打开方式可配**。默认仍走系统默认浏览器，也可以只让「AI 搜索」用 ego lite 打开
（`ego.exe <url>`，自动探测安装位置，找不到就退回系统默认）。Windows 不允许程序静默改默认浏览器，
所以这是一个插件级开关，而不是去动系统的 `UserChoice`。

原项目版权与许可声明见 `LICENSE`（未改动）。

自定义技能的写法见 [docs/custom-skills.md](docs/custom-skills.md)，示例包在
[docs/custom-skills.samples.json](docs/custom-skills.samples.json)（8 个，`scripts/check-samples.mjs` 会校验它们能通过 `normalizeSkills` 并正常渲染变量）。

---

## 1. 改了什么（按文件）

| 文件 | 改动 |
|---|---|
| `src/shared/skills.ts` | **新增**。技能模型：`Skill`、`DEFAULT_SKILLS`（与截图一致的 6 个）、`normalizeSkills` 校验、`menuProjection`、`renderPrompt` 模板渲染、图标白名单。 |
| `src/shared/protocol.ts` | 设置里加 `toolbarEnabled` / `topN` / `skills` / `menuTimeoutMs`；`RunRequest` 加 `skillId`，`action` 变可选（向后兼容旧客户端与 `/simulate`）。 |
| `src/index.ts` | 新路由语义：`POST /run` 接受 `skillId`，`resolveSkill` 找技能 → `composePrompt`（内置动作走原 `buildPrompt`，自定义技能走模板）；模型座位按技能的内置动作取（`seatFor`）。 |
| `src/settings.ts` | 读设置时**去掉 BOM**（`\uFEFF`），否则被 PowerShell / 记事本另存过的 JSON 会让整份设置退回默认。 |
| `companion/menu-model.mjs` | **新增**。纯几何：段宽估算（CJK 全角）、`splitSkills`（前 N + 更多）、`layoutBar` / `layoutList`、`hitBar` / `hitList`、`placeBar` / `placeList` / `placeListForMore`。无 Win32 依赖，可直接单测。 |
| `companion/skills-config.mjs` | **新增**。伴生进程只读 `DSH_HOME/dsh-select-assist.json`（按 mtime 缓存），取 `skills` / `topN` / `toolbarEnabled` / `menuTimeoutMs`；同样去 BOM；环境变量 `DSH_SELECTION_MENU_TIMEOUT_MS` 优先（排障用）。 |
| `companion/search-url.mjs` | **新增**。搜索地址模板：`normalizeSearchUrl`（必须 http(s) 且含 `%s`，否则回默认秘塔）、`buildSearchUrl`（只替换第一个 `%s`，查询词折叠空白并截到 200 字）。 |
| `companion/open-url.mjs` | **新增**。用哪个浏览器打开：`egoCandidates` / `resolveEgoExe`（自定义路径 → Program Files → x86 → LocalAppData，全部不存在返回 null）、`openUrl`（ego 模式 `detached` 拉起 `ego.exe <url>`；找不到可执行文件自动退回 `rundll32` 系统默认）。 |
| `companion/link-fetch.mjs` | **新增**。链接抓取：`isHttpUrl`（整段必须就是一个链接）、`isBlockedHost`（本机/内网/链路本地一律拒绝，含 DNS 复查）、`htmlToText`（去脚本样式、块级转换行、解码实体）、`fetchLinkText`（8s 超时、2MB 下载上限、4000 字正文上限，失败安静降级）。 |
| `companion/main.mjs` | 菜单状态加 `mode`（`bar`/`list`）、`layout`、`bar`、`overflow`、`timeoutMs`；`showMenu` 按技能数算尺寸并用 `placeBar` 定位；点「更多」→ `expandMenuList()` 把同一块窗口重开成竖排列表；`menuItemOf` 把命中行映射成技能；`runMenuAction(skill)` 取代 `menuActionOf(row)`；`armMenuTimer` / `pauseMenuTimer` / `resumeMenuTimer` 负责停留时长与悬停暂停；**点自定义技能且选区是链接时先 `fetchLinkText` 抓正文当 context**；新增本机动作 `copySelection` / `searchSelection`；自定义技能 `output: clipboard` 在 `done` 时自动复制。 |
| `companion/native/ui.mjs` | `menuRowAt` → `menuHit(state, x, y)`；`paintMenu` 支持 `bar` / `list` 两种形态；面板标题与图标改读 `state.title` / `state.icon`（技能名而不是动作名）；新增图标 `search` / `wand` / `book` / `bolt` / `more`。 |
| `src/client/skills-field.tsx` | **新增**。设置页的「技能管理」：总开关、常驻数量、卡片列表（拖拽排序、启用开关、删除）、添加/编辑表单（名称、9 个图标、提示词、结果落点）。 |
| `src/client/settings.tsx` | 挂上 `SkillManager` 作为 01 区，其余区块顺延为 02–05。 |
| `src/client/icons.tsx` | 补 `search` / `copy` / `globe` / `wand` / `book` / `speak` / `bolt` / `more` / `trash`。 |
| `test/skills.test.mjs`、`test/menu-model.test.mjs` | **新增** 21 个单测。 |
| `test/panel-zone.test.mjs` | 两个菜单用例从「固定四段」改写为「按布局命中」与「更多→列表」。 |

---

## 2. 数据模型

```jsonc
// %DSH_HOME%/dsh-select-assist.json
{
  "toolbarEnabled": true,
  "topN": 5,
  "menuTimeoutMs": 15000,
  "skills": [
    { "id": "builtin.search", "name": "AI 搜索", "icon": "search", "kind": "builtin", "action": "search",
      "output": "panel", "enabled": true, "deletable": false },
    { "id": "sk_optimize_prompt", "name": "优化提示词", "icon": "wand", "kind": "prompt",
      "prompt": "你是提示词工程师…… 原文：\n{{text}}", "output": "panel", "enabled": true, "deletable": true }
  ]
}
```

规则：

- `builtin` 技能不可删（`deletable` 是派生值），只能排序 / 停用；配置里被删光会自动补回。
- `topN` 含「更多」：`topN=5` → 浮条 4 个技能 + 1 个「⋯」。
- 浮条装不下（屏幕窄）时按宽度继续往「更多」里挪，至少保留一个。
- 模板变量：`{{text}}` / `{{context}}` / `{{lang}}`；模板里没有 `{{text}}` 会自动补一段原文。
- `output: clipboard` 的技能生成完自动复制一份。
- `menuTimeoutMs`：浮条停留时长（默认 10000，夹在 2000–60000）。**鼠标停在浮条上时不计时**，
  移开后重新从头计时；`DSH_SELECTION_MENU_TIMEOUT_MS` 环境变量可临时覆盖。

---

## 3. 交互

- 划词 → 浮条出现（锚点右下，越界回收）；鼠标移到段上有高亮。
- 点「⋯」→ 同一窗口变成竖排列表（贴浮条下沿，下方放不下就翻到上方）。
- 点任一技能 → 解析选区 → 面板流式输出，标题/图标用技能自己的。
- 本机动作不开面板：复制（写剪贴板，`/status.lastCopy`）、朗读（SAPI）、搜索（默认浏览器打开 Bing）。
- 浮条停留时长在设置页可调（2–30s 滑块），默认 10s；鼠标停在浮条或下拉上不消失。
- 设置页改动即时防抖落盘；伴生进程按文件 mtime 生效，**不用重启**。

---

## 4. 验证状态

已跑通：

```
node_modules/typescript 5.6.3
  tsc --noEmit           → 0 errors（src 下 13 个 .ts/.tsx 全部纳入）
  tsdown 0.23.0 build    → lib/index.js 48.7 kB / lib/client.js 101.5 kB，banner 正常
单测（node --experimental-strip-types，逐文件运行；本机沙箱禁止 node --test 的 spawn）
  companion-manager 4 · gesture 12 · link-fetch 9 · menu-model 12 · panel-zone 19 · policy 26
  selection 20 · skills 10 · speak-tuning 5 · menu-flow 7 · settings-skills 6
  → 130 passed, 0 failed
```

`menu-flow.test.mjs` 用临时 `DSH_HOME` 把「主进程落盘的 JSON → 伴生进程读回 → 拆浮条/下拉
→ 停留时长」这条链路端到端跑了一遍；`settings-skills.test.mjs` 钉住默认值、`topN` 夹取与落盘形状。

### 在运行中的应用里实测（v0.11）

插件装好后可以直接打它的调试路由验证（不用重启应用）：

```powershell
# 重启伴生进程（改了浮层/伴生代码时）
curl -X POST http://127.0.0.1:11514/api/dsh-select-assist/system/restart
# 让浮条在指定坐标出现
curl -X POST http://127.0.0.1:<companionPort>/simulate -H "content-type: application/json" `
     -d '{"text":"测试","x":700,"y":420}'
```

用 `menuTimeoutMs: 3000` 跑：0.6s 时 `menu.visible=true`，4s 时 `false` 且
`lastMenuDismiss.reason=timeout`；改成 15000 后 10s 时仍然 `visible=true`。
—— 停留时长确实按设置走，不是只改了默认值。

**未验证**：

1. 手势划词（真实拖选/双击）在各类应用里的取词质量——本机只能在指定坐标 `simulate`；
2. `dsh plugin add` 安装到 desktop profile——CLI 对 `desktop` 直接拒绝，只能走应用内「插件 → 添加插件」。

### 真实渲染（不是 mock）

`scripts/preview.mjs` 复用**同一套** `paintMenu` + `menu-model.mjs`，用 koffi + GDI+ 建一块
原生分层窗口、自绘、抓屏。所以下面这两张是从真实绘制代码里出来的（150% 缩放）：

| 浮条（4 常驻 + 更多） | 「更多」下拉（2 项） |
|---|---|
| ![浮条](docs/preview-bar.png) | ![下拉](docs/preview-list.png) |

```powershell
node scripts/preview.mjs "<dsh>/resources/app.asar.unpacked/dsh/node_modules/koffi" out.bmp bar
node scripts/preview.mjs "<dsh>/resources/app.asar.unpacked/dsh/node_modules/koffi" out.bmp list
```

这一步抓到两个真问题：

1. **标签被 GDI+ 截成「复…」「翻…」「优化提…」**：段宽按「中文 = 1 个字宽」估算，比字面窄
   1~2px；「更多」段还写死 40px，两个全角字根本放不下。改成全角 1.06 倍 + 每段 +2px 余量，
   `moreSegmentWidth()` 按同一规则算（浮条因此从 380 变 430 DIP——宁可宽一点，不能把字吃掉）。
2. **下拉挂在浮条最左边**：之前 `placeList` 用浮条左沿，430 DIP 宽的浮条上会离「更多」按钮
   一屏远。新增 `placeListForMore`：与「更多」段左对齐，右边放不下就右对齐到该段右沿，
   再夹进工作区；下方放不下翻到上方。有单测。

真机实测时又抓到一个：

3. **设置文件带 BOM 会让整份设置失效**：PowerShell 的 `Set-Content -Encoding utf8` 在
   Windows PowerShell 5.1 下写的是带 BOM 的 UTF-8，`JSON.parse` 直接抛，主进程与伴生进程
   双双退回默认值（表现为"我改了配置但没生效"）。读写两侧都加了 `replace(/^\uFEFF/, '')`，
   并补了一条 BOM 用例。

冒烟顺序建议：`system/restart` → 在记事本划词 → 确认 6 个技能 = 4 常驻 + 「更多」2 项 →
点「优化提示词」→ 改设置里的顺序/新增技能 → 再看浮条。

---

## 5. 复现构建

依赖装在仓库内（本机 npm 的全局缓存目录被沙箱拒绝，所以 `--cache` 指到本地）：

```powershell
npm install --no-save --ignore-scripts --cache .\.npm-cache `
  typescript@5.6.3 @types/node@24 @types/react@18 @types/react-dom@18 tsdown@0.23.0
node node_modules\typescript\bin\tsc --noEmit     # 0 errors
node node_modules\tsdown\dist\run.mjs             # lib/index.js + lib/client.js
```

正式安装仍走 pnpm：`pnpm install && pnpm build`，然后

```powershell
dsh plugin --profile desktop add E:\dsh\skill-bar
```

（本机 `dsh` 不在 PATH，实际用 dshmarket 的「发现 → 本地安装」或 DSH 桌面端的插件页。）

## 6. 还没做（按优先级）

1. **页内兜底菜单未同步**：`src/client/overlay.tsx` 仍是固定四项（系统级不可用时接管）。
   它调 `/run` 只传 `action`，所以功能不坏，但浮条样式与技能列表不一致。
2. 技能级模型座位（现在自定义技能跟随会话/部署默认）。
3. 图标上传（现在只有 9 个内置图标）。
4. 内置技能名/描述的多语言（`DEFAULT_SKILLS` 目前只有中文）。
5. 「发现更多技能」（预置技能包）。
