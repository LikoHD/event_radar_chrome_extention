# Tea Event Radar 产品技术方案说明

> Status: Implemented
> Source of truth: 当前仓库代码实现
> Last synced: 2026-09-05
> Freshness: 🟢 FRESH
> Scope: `Manifest V3` + `Service Worker 网络拦截` + `页面上下文探测` + `平台识别与解析` + `Side Panel / 页内面板` + `CSV 导出` + `过滤规则`

---

## v1.1.0 实验探查扩展

新增 A/B Test tab、独立实验采集/会话/证据链，以及独立 AI API 设置页（默认 DeepSeek V4 Flash）。实验采集与原埋点监控独立控制，详情和支持边界以 [A/B 探查说明](abtest-explorer-0905.md) 为准。新增 MAIN world 与隔离世界探针，最低 Chrome 111；本地扩展存储限制为可信上下文，原页内面板宽度通过后台消息读取和保存。

## 1. 文档目的

本文档描述 Tea Event Radar 当前已经落地的真实实现，用来回答三个问题：

- 现在这个扩展到底能抓什么、怎么抓
- 捕获后的请求如何被识别、解析和展示
- 当前有哪些能力、边界和已知取舍

这份文档不再描述“理想设计”或旧方案，统一以当前代码为准。

---

## 2. 当前实现快照

### 2.1 版本与入口

- 扩展 `manifest.json` 当前版本：`1.0.5`
- 构建配置 `package.json` 当前版本：`1.0.4`
- 面板 UI 头部展示版本：`1.1`

说明：

- 当前代码里的版本号尚未完全统一，本文档统一以 `manifest.json` 的 `1.0.5` 作为当前扩展版本标识。

### 2.2 核心能力

当前实现已经具备以下能力：

1. 基于 `chrome.webRequest` 捕获已知平台特征请求，支持 `GET` / `POST`
2. 基于 `platform-catalog.js` 做请求预过滤，降低无关请求噪音
3. 基于 `platform-adapters.js` 做 matcher + parser 双层识别
4. 结合页面脚本、Cookie、主世界全局变量做平台识别加权
5. 对部分 gzip / 二进制 / 私有协议请求保留原始 body 的 base64 备份
6. 对神策 gzip 和知乎 gzip+protobuf 做异步二次解码
7. 支持 Side Panel 与页内 iframe 面板两种展示方式
8. 支持平台过滤、关键词搜索、复制、CSV 导出、清空、宽度拖拽
9. 支持 URL 级 Regex 过滤规则、白名单规则与常用预设

### 2.3 当前平台覆盖

当前内置 **36 个已识别平台适配器**，另保留 `unknown` 兜底视图。

按目录优先级分组如下：

| 优先级 | 平台 |
|------|------|
| P0 | `datarangers` |
| P1 | `sensors` `google` `baidu` `alibaba` `tencent` `netease` `didi` `meituan` `jd` `bilibili` `xhs` |
| P2 | `ctrip` `amazon` `meta` `linkedin` `pinterest` `reddit` `x` `zhihu` `weibo` `snap` `microsoft_uet` `growingio` `mixpanel` `segment` `amplitude` |
| P3 | `matomo` `plausible` `umami` `posthog` |
| P4 | `adobe` `tiktok` `heap` `hotjar` `clarity` |

其中较明确的“部分解析 / 保守解析”平台包括：

- `ctrip`：恢复稳定字段，不做私有打包完整逆向
- `amazon`：覆盖站内 telemetry 主链路，不含 Ads/Attribution 全量语义
- `zhihu`：恢复 gzip/protobuf hints 与页面实体字段，不做 schema 级完整还原
- `snap`：保守展开常见字段，不猜未公开参数
- `microsoft_uet`：只覆盖 `bat.bing.com/action/0`
- `bilibili`：`pbrequest` 仅恢复稳定字段

---

## 3. 系统架构

### 3.1 主链路

```text
Web Page
  ├─ 页面 JS 发起埋点请求
  ├─ content-script.js
  │   ├─ 扫描 script[src]
  │   ├─ 扫描 Cookie
  │   └─ 上报页面上下文给 Service Worker
  │
  └─ chrome.action 点击后可注入页内 iframe 面板

Service Worker
  ├─ 根据 PlatformCatalog 预过滤 URL
  ├─ onBeforeRequest 读取 URL / body / documentId / frameId
  ├─ 保存可疑二进制 body 的 base64
  ├─ 结合页面上下文调用 PlatformAdapters.matchPlatform()
  ├─ 命中后写入 capturedEvents[]
  ├─ 必要时做异步二次解码
  └─ 防抖推送 updateEvents 给面板

panel.html + panel.js
  ├─ 自动启动捕获
  ├─ 平台过滤 / 关键词过滤
  ├─ NormalizedEvent 渲染
  ├─ 复制 / CSV 导出
  ├─ 设置面板：过滤规则 / 白名单 / 预设
  └─ 拖拽调整宽度
```

### 3.2 模块清单

| 文件 | 职责 |
|------|------|
| `tea_event_radar/manifest.json` | 扩展权限、入口与资源声明 |
| `tea_event_radar/service-worker.js` | 网络拦截、平台匹配、事件缓存、消息分发、页内面板注入 |
| `tea_event_radar/content-script.js` | 页面上下文探测、提示信息、页内面板宽度联动 |
| `tea_event_radar/panel.html` | 面板结构、设置侧栏、操作区 |
| `tea_event_radar/panel.js` | 事件渲染、过滤、CSV、复制、设置规则、宽度控制 |
| `tea_event_radar/panel.css` | 面板 UI 样式 |
| `tea_event_radar/in-page-panel.css` | 页内面板宿主样式 |
| `tea_event_radar/analytics-core.js` | 通用解码、JSON / Query / 时间戳等工具函数 |
| `tea_event_radar/platform-catalog.js` | 平台目录、图标、优先级、识别 hints |
| `tea_event_radar/platform-adapters.js` | 各平台 matcher / parser 与 NormalizedEvent 输出 |
| `tea_event_radar/background.js` | 旧版 background 代码，当前未被 manifest 引用 |
| `build.js` | 构建 `dist/` 与 ZIP 打包 |

### 3.3 当前代码规模

| 文件 | 行数 |
|------|------|
| `service-worker.js` | 1131 |
| `panel.js` | 1703 |
| `platform-adapters.js` | 4542 |
| `platform-catalog.js` | 903 |
| `analytics-core.js` | 501 |
| `content-script.js` | 273 |

---

## 4. Manifest 与权限模型

### 4.1 权限

```json
{
  "permissions": [
    "webRequest",
    "scripting",
    "activeTab",
    "sidePanel",
    "clipboardWrite",
    "storage"
  ],
  "host_permissions": ["<all_urls>"]
}
```

权限用途：

- `webRequest`：读取请求 URL、body、headers、状态码
- `scripting`：注入页内面板与 MAIN world 探测脚本
- `activeTab`：当前标签页内的面板注入与通信
- `sidePanel`：Chrome 侧边栏面板入口
- `clipboardWrite`：复制内容到系统剪贴板
- `storage`：保存面板宽度、过滤规则、白名单规则

### 4.2 入口与运行方式

| 入口 | 配置 | 当前行为 |
|------|------|------|
| Background | `service_worker: service-worker.js` | 所有核心逻辑都在 Service Worker |
| Content Script | `matches: <all_urls>`, `all_frames: true` | 所有页面、所有 frame 注入，负责上下文探测 |
| Side Panel | `default_path: panel.html` | 可作为浏览器侧边栏打开 |
| Action 点击 | `chrome.action.onClicked` | 优先向页面注入右侧 iframe 面板 |
| Web Accessible Resources | `panel.html/css/js` 与平台模块 | 允许页内 iframe 正常加载面板资源 |

---

## 5. 事件捕获与平台识别

### 5.1 预过滤

当前不会对所有请求做重解析，而是先用 `platform-catalog.js` 的 `hosts` / `paths` 建立索引：

```javascript
if (shouldCapture(details.url, details.method) && !isUrlFiltered(details.url)) {
  // 进入平台识别与解析流程
}
```

这一步的作用是：

- 降低无关请求进入重解析逻辑的比例
- 保持 Service Worker 在高流量页面下可控
- 给后续 matcher 提供已知平台范围内的候选集

### 5.2 页面上下文加权

仅靠请求 URL 不足以稳定识别当前平台，因此实现里额外维护了页面上下文缓存：

- `content-script.js` 在隔离世界扫描 `script[src]`
- `content-script.js` 读取可访问 Cookie 特征
- `service-worker.js` 使用 `chrome.scripting.executeScript(..., { world: "MAIN" })` 探测主世界全局变量
- 结果按 `tabId + documentId / frameId` 缓存在 `pageContextCache`

这些信号不会单独把 `unknown` 硬判成某个平台，但会给已接近命中的请求做加权提升。

### 5.3 三阶段请求捕获

| 阶段 | Chrome API | 提取内容 |
|------|-----------|---------|
| 1 | `webRequest.onBeforeRequest` | URL、方法、请求体、`documentId`、`frameId` |
| 2 | `webRequest.onSendHeaders` | 请求头数组 |
| 3 | `webRequest.onCompleted` | HTTP 状态码 |

### 5.4 请求体处理策略

POST 请求体采用两条并行策略：

1. 文本解码链路
   - `TextDecoder('utf-8')`
   - `decodeURIComponent(...)`
   - `String.fromCharCode(...)` 原样回退
2. 二进制保留链路
   - 若 body 命中 gzip magic number 或存在明显二进制特征，则额外保存 `requestBodyBase64`

这样做的目的不是直接把所有二进制请求完整还原，而是让后续平台 parser 和异步解码仍有机会利用原始字节。

### 5.5 平台匹配与解析

匹配逻辑统一走：

```javascript
const matchResult = TeaRadar.PlatformAdapters.matchPlatform(request, pageContext);
const normalizedEvents = TeaRadar.PlatformAdapters.parseRequest(platformId, request);
```

输出统一归一为 `NormalizedEvent`：

```javascript
{
  platform: "google",
  eventName: "page_view",
  userId: "",
  anonymousId: "abc",
  distinctId: "abc",
  eventTime: "2026-03-22T10:00:00.000Z",
  properties: { ... },
  rawEvent: { ... }
}
```

UI、复制、CSV 都尽量基于这层统一模型工作，而不是继续依赖某一家平台的私有格式。

### 5.6 异步二次解码

当前已落地两条异步解码链路：

| 平台 | 触发条件 | 当前行为 |
|------|---------|---------|
| `sensors` | form body 内 `data` / `data_list` 为 gzip payload | `DecompressionStream('gzip')` 解压后写回 `event.requestData` |
| `zhihu` | 保留了 gzip/protobuf 的 `requestBodyBase64` | 解压 gzip 后做 protobuf walker，提取 `pageUrl`、`pageType`、实体 ID、稳定事件候选 |

说明：

- 这里的目标是“提升可读性和识别度”，不是完整逆向私有协议
- 解码结果会回写 `requestData` 并触发面板刷新

---

## 6. 面板交互与展示

### 6.1 当前 UI 行为

当前 `panel.js` 的默认行为与旧文档相比有几个关键变化：

- 面板加载后会自动发送 `startCapturing`
- 平台过滤默认值是 `__known__`，即“只看已识别平台”
- 所有平台事件卡片优先通过 `PlatformAdapters.parseRequest()` 渲染
- 页内面板本质上是注入到目标页面中的一个 `iframe(panel.html)`

### 6.2 平台过滤

| 选项 | 值 | 过滤逻辑 |
|------|---|---------|
| 已识别平台（默认） | `__known__` | `platformId !== 'unknown'` |
| 全部平台 | `''` | 不过滤 |
| 单个平台 | 某个 `platformId` | 精确匹配 |
| 未知平台 | `unknown` | `platformId === 'unknown'` |

平台列表由 `PlatformCatalog.getPlatformsByPriority()` 动态生成，因此会随平台目录自动扩展。

### 6.3 搜索与渲染

- 搜索支持输入框空格拆词 + Enter 固化 tag
- 支持 `include` / `exclude` 两种模式
- 匹配范围是事件对象 `JSON.stringify(...)` 的全文小写匹配
- 渲染防抖：`50ms`
- 搜索防抖：`200ms`
- 最多只渲染最新 `100` 条事件

### 6.4 事件卡片

卡片展示由三部分组成：

1. 头部
   - 平台 badge
   - `EVENT / API` 标签
   - 事件名
   - 用户标识
   - 捕获时间
2. 事件信息
   - 归一化后的事件名
   - 用户标识
   - 事件时间
   - 参数表格
3. 请求信息与原始数据
   - 请求 URL
   - `requestData` 的 JSON 或 raw fallback

### 6.5 复制与 CSV

复制：

- 事件区复制的是事件名列表
- 原始数据区复制的是格式化后的 raw 数据
- 采用 `navigator.clipboard` -> `execCommand('copy')` -> 手动复制弹窗 三层回退

CSV：

- 编码：UTF-8 with BOM
- 字段：时间戳、事件名称、用户 ID、状态码、请求 URL、事件参数、原始数据
- 优先使用 `PlatformAdapters.parseRequest()` 结果导出
- 适配器解析失败时再回退到 `requestData` 原始解析

### 6.6 设置面板

当前面板右上角设置按钮会打开一个侧边设置栏，支持三类配置：

| 能力 | 存储键 | 说明 |
|------|------|------|
| 过滤规则 | `filterRules` | 命中 URL Regex 的请求将被排除 |
| 白名单规则 | `whitelistRules` | 命中 URL Regex 的请求将强制保留，优先级高于过滤规则 |
| 快速预设 | — | 一键加入 `gstatic`、字体、静态资源、source map、websocket 等常见噪音规则 |

当前过滤发生在 Service Worker 预过滤之后、真正入库之前。

---

## 7. 存储模型

### 7.1 `chrome.storage.local`

| Key | 类型 | 用途 |
|-----|------|------|
| `panelWidth` | `number` | 面板宽度 |
| `filterRules` | `Array<{ pattern, enabled }>` | URL 过滤规则 |
| `whitelistRules` | `Array<{ pattern, enabled }>` | URL 白名单规则 |

### 7.2 内存状态

| 变量 | 文件 | 说明 |
|------|------|------|
| `capturedEvents[]` | `service-worker.js` | 已捕获事件，默认上限 1000 |
| `pageContextCache` | `service-worker.js` | 页面上下文缓存，TTL 30 分钟 |
| `isCapturing` | `service-worker.js` | 当前是否捕获中 |
| `allEvents[]` | `panel.js` | 面板收到的事件副本 |
| `expandedCards` | `panel.js` | 卡片展开状态 |
| `searchKeywords[]` | `panel.js` | 搜索 tag |

### 7.3 生命周期

```text
请求命中已知平台特征
  → Service Worker 捕获并识别
  → 写入 capturedEvents[]
  → updateEvents 推送到面板
  → 面板按当前过滤条件渲染
  → 用户复制 / 导出 / 清空
```

说明：

- 事件本身不做持久化
- 扩展刷新、浏览器关闭或 Service Worker 被回收后，内存事件会丢失

---

## 8. 消息通信

### 8.1 Panel → Service Worker

| 消息 | 说明 |
|------|------|
| `getEvents` | 读取当前缓存事件 |
| `clearEvents` | 清空事件 |
| `startCapturing` | 开始捕获 |
| `stopCapturing` | 停止捕获 |
| `getStatus` | 查询捕获状态 |
| `resizePanel` | 调整页内面板宽度 |
| `updateFilterRules` | 同步过滤规则与白名单 |

### 8.2 Content Script → Service Worker

| 消息 | 说明 |
|------|------|
| `updatePageContext` | 上报页面脚本 / Cookie 探测结果，由 Worker 补 MAIN world globals |

### 8.3 Service Worker → Panel / 页面

| 消息 | 说明 |
|------|------|
| `updateEvents` | 推送最新事件数组 |
| `resizePanel` | 兜底广播宽度变化给已注入页内面板 |
| `showInPagePanel` / `openSidePanel` | 旧兼容消息，当前主链路已很少依赖 |

---

## 9. 性能与取舍

### 9.1 当前阈值

| 项目 | 数值 | 作用 |
|------|------|------|
| `MAX_EVENTS` | 1000 | Service Worker 内存事件上限 |
| `CLEANUP_THRESHOLD` | 1200 | 惰性清理阈值 |
| `UPDATE_DEBOUNCE_TIME` | 100ms | 事件推送防抖 |
| `MAX_VISIBLE_EVENTS` | 100 | UI 最大可见事件数 |
| `RENDER_DEBOUNCE_TIME` | 50ms | UI 渲染防抖 |
| `SEARCH_DEBOUNCE_TIME` | 200ms | 搜索防抖 |

### 9.2 主要取舍

| 取舍 | 当前选择 | 理由 |
|------|------|------|
| 全量流量拦截 vs 平台预过滤 | 平台预过滤 | 降低开销，优先看埋点请求 |
| 完整协议逆向 vs 稳定字段恢复 | 后者 | 控制复杂度，优先提升可用性 |
| 事件持久化 vs 内存缓存 | 内存缓存 | 逻辑简单，避免频繁写存储 |
| 全量渲染 vs 截断渲染 | 最新 100 条 | 保证高频页面下 UI 可用 |
| 精细字段过滤 vs 全文匹配 | 全文匹配 | 成本低，覆盖所有字段 |

---

## 10. 构建与分发

当前项目已经有构建流程，不再是“完全无构建”状态。

### 10.1 命令

```bash
npm install
npm run build
npm run clean
```

### 10.2 当前构建行为

- `build.js` 复制扩展资源到 `dist/`
- 使用 `terser` 压缩 JS
- 产出 `tea_event_radar_dist.zip`

---

## 11. 已知限制

| 限制 | 说明 |
|------|------|
| 预过滤依赖平台目录 | 自定义代理域名、第一方转发、路径重写场景仍可能漏抓 |
| 部分平台仅恢复稳定字段 | 例如 `zhihu`、`bilibili`、`ctrip`、`amazon` |
| 无事件持久化 | 只保留当前扩展会话内内存数据 |
| UI 仅显示最新 100 条 | 高频页面下旧事件会被截断显示 |
| 过滤规则只作用于 URL | 还不支持按事件字段、状态码、时间范围做结构化过滤 |
| 外部图标依赖 CDN | `RemixIcon` 离线环境可能缺失 |
| 版本号未统一 | manifest、package、面板头部版本号当前不一致 |

---

## 12. 相关文档

- 当前实现总览：`docs/product-technical-spec.md`
- 本次同步检查：`docs/documentation-sync-2026-03-22.md`
- 历史增强里程碑：`docs/event-parsing-enhancement-spec.md`
- 性能专项说明：`docs/performance-optimization-spec.md`
- 平台研究参考：`docs/analytics-platform-tracking-spec.md`
- 平台研究补充：`docs/analytics-platform-tracking-reference.md`

---

## 附录 A：当前与旧文档最容易混淆的点

1. 面板现在默认打开后就会自动开始捕获，不需要先点一次 `RadarUp`
2. 平台覆盖已经从早期 17 个扩展到当前 36 个
3. 现在已经支持设置页中的 Regex 过滤规则和白名单规则
4. 现在会保留可疑二进制 body 的 base64，供后续平台解析继续使用
5. CSV 导出已经会优先走平台适配器归一化结果，而不是只认老的 DataRangers 格式

## 1.1.3 交互与协议补充

AI 点击即发送脱敏快照，不再要求预览确认。新增「方案总结」子 tab，四个统计按钮导航并展开相应分类。实际访问 15 个网站入口后补充私有协议适配；协议依据与未覆盖范围见 `research/sites-observed-2026-09-05.md`，验证见 `validation/abtest-1.1.3.md`。
