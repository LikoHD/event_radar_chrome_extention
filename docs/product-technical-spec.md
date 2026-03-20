# Tea Event Radar 产品技术方案说明

> Status: Planned
> Source of truth: 本文档（升级后目标方案，当前仓库代码为基线参考）
> Last synced: 2026-03-19
> Freshness: 🟢 FRESH
> Scope: `Cross-platform analytics interception middleware` + `Platform research` + `Brand assets` + `Homepage platform filter`

---

## 1. 文档目的

本文档用于定义 Tea Event Radar 从“字节系特定接口监控插件”升级为“跨平台埋点拦截中间层”的完整产品与技术方案。

这份文档的目标不是复述当前仓库已经实现的能力，而是提供一份可以直接指导后续开发的目标设计说明，覆盖：

- 产品目标、范围边界与成功标准
- 当前实现基线与存在问题
- 主流埋点平台的上报接口特征调研
- 插件升级后的分层架构、数据模型和核心链路
- 首页筛选、平台品牌 icon 素材、统一可视化方案
- 测试、验收、风险和后续演进方向

当前仓库代码仅作为基线参考，主要对应以下文件：

- `tea_event_radar/service-worker.js`
- `tea_event_radar/panel.js`
- `tea_event_radar/panel.html`
- `tea_event_radar/content-script.js`
- `tea_event_radar/manifest.json`

---

## 2. 产品目标与范围

### 2.1 产品目标

Tea Event Radar 的升级目标是把当前仅面向单一埋点格式的监控插件，升级为一个可拦截、识别、分析并可视化展示多平台埋点请求的浏览器侧调试工具。

升级后的核心价值如下：

1. **跨平台拦截**：覆盖主流商业埋点平台和常用开源埋点方案
2. **统一分析**：将不同平台的请求归一化为统一事件模型
3. **统一可视化**：在同一个面板中展示平台、事件、用户、参数和原始请求
4. **平台维度筛选**：支持在首页搜索区按平台多选过滤
5. **品牌识别增强**：每个平台展示对应品牌 icon，提高识别效率

### 2.2 目标用户

| 用户角色 | 典型使用场景 |
|---------|-------------|
| 前端开发者 | 调试页面埋点是否正确发送、字段是否完整 |
| 数据分析师 | 对比不同埋点平台在同页面上的上报内容 |
| QA 测试 | 批量验收埋点需求，快速筛选特定平台的上报 |
| 产品经理 | 直观看到页面有哪些行为被哪些平台采集 |
| 集成工程师 | 排查多 SDK 并存、代理上报、自定义域名导致的采集问题 |

### 2.3 功能范围

本次升级范围限定为 **Web/H5 场景**，即浏览器页面中可观测到的埋点请求。

包含：

- 页面发起的 `fetch` / `XMLHttpRequest` / `sendBeacon` / 像素请求
- 主流埋点平台默认采集域名
- 自定义采集域名或代理路径的识别
- 请求体解码、平台识别、规范化、UI 展示、筛选和导出

不包含：

- 原生 App SDK 的请求抓取与解析
- 纯服务端埋点 API 的运行时拦截
- 插件对页面运行时的侵入式 hook 改写
- 将事件持久化到远程服务

### 2.4 成功标准

升级后方案的验收标准如下：

- 插件可识别并展示多种主流埋点平台请求，不再依赖单一 `list` 规则
- UI 可按平台多选筛选，平台筛选位于首页搜索框左侧
- 平台列表和事件卡片显示品牌 icon
- 不同平台的数据都能落入统一事件视图，解析失败时也保留原始请求
- 文档、平台目录、图标素材和 UI 规则能够支持后续继续扩平台

---

## 3. 当前实现基线

### 3.1 当前架构概览

当前仓库代码已经实现了一个可工作的浏览器侧边栏插件，主要能力包括：

- Service Worker 使用 `chrome.webRequest` 拦截请求
- Side Panel / 页内面板展示事件列表
- 搜索过滤、展开查看、复制和 CSV 导出
- UTF-8 与中文乱码回退解码
- 面板宽度拖拽和事件数上限控制

### 3.2 当前拦截规则

当前实现的核心拦截逻辑在 `tea_event_radar/service-worker.js` 中，规则等价于：

```javascript
if (details.method === "POST" && details.url.includes("list")) {
  // 捕获请求
}
```

该规则隐含了三个非常强的假设：

1. 埋点请求一定是 `POST`
2. 埋点 URL 一定包含 `list`
3. 请求体结构接近字节系 `events / user / header`

### 3.3 当前 UI 解析假设

当前 `tea_event_radar/panel.js` 在渲染卡片时，默认按如下结构解析：

```json
[{
  "events": [
    {
      "event": "event_name",
      "params": "{\"key\":\"value\"}"
    }
  ],
  "user": {
    "user_unique_id": "xxx"
  }
}]
```

这意味着当前 UI 的事件标题、用户信息、参数表格、CSV 导出都和字节系请求体结构强耦合。

### 3.4 当前方案的主要问题

| 问题 | 说明 |
|------|------|
| 平台覆盖过窄 | 无法识别 Google、百度、神策、Matomo 等主流平台 |
| 传输方式假设过强 | `GET` 像素请求、`sendBeacon`、表单上报会被漏抓或无法解析 |
| 请求关联不稳 | 当前主要按 `url` 回填 headers / status，并发同 URL 请求时可能串单 |
| UI 无平台视角 | 首页没有平台筛选，卡片也不显示平台归属 |
| 素材缺失 | 目录中只有插件自身图标，没有平台品牌素材 |
| 扩展成本高 | 每加一个平台都要在 `service-worker.js` 和 `panel.js` 中写分支，缺少统一管理层 |

---

## 4. 升级后产品方案

### 4.1 产品定位

Tea Event Radar 升级后将被定义为一个 **埋点拦截中间层（管理层）**，其职责不是只为某个平台做特化解析，而是：

- 从浏览器网络层收集候选埋点请求
- 识别请求属于哪个平台或哪类方案
- 对请求进行结构化解析与归一化
- 在 UI 上以统一方式进行展示、筛选、分析和导出

### 4.2 用户可见能力

升级后，用户在面板中应感知到的变化包括：

1. 同一页面的不同平台埋点会被统一展示
2. 事件卡片头部可直接看到平台名称和品牌 icon
3. 首页顶部在搜索框左侧新增“平台多选筛选”
4. 搜索和平台筛选可以叠加使用
5. 即使某个平台未完整解析，也能以原始请求形式被看到，而不会被直接遗漏

### 4.3 核心用户路径

```text
用户浏览网页
  → 点击扩展图标打开面板
  → 点击 "RadarUp" 开始捕获
  → 页面发起各类埋点请求（fetch / XHR / beacon / image）
  → 插件识别平台并做归一化处理
  → 事件卡片实时出现在面板中
  → 用户通过平台多选 + 关键词搜索筛选事件
  → 展开卡片查看规范化事件、匹配依据、请求信息、原始载荷
  → 复制或导出 CSV
```

---

## 5. 平台覆盖与接口特征调研

### 5.1 平台覆盖原则

本次方案要求覆盖三类对象：

1. **明确点名的商业平台**：神策、Google、百度
2. **主流商业分析平台**：GrowingIO、Mixpanel、Amplitude、Segment
3. **常见开源方案**：Matomo、Plausible、Umami、PostHog

同时纳入调研但首版可先只做识别或延后完整解析的平台：

- Adobe Analytics
- RudderStack
- 友盟+

### 5.2 调研说明

下表中的信息分为两类来源：

- **官方文档可确认**：来自官方 SDK / API / 部署文档
- **公开网络行为或 SDK 初始化特征推断**：来自平台公开脚本、已知请求路径、常见接入方式的归纳

### 5.3 平台特征总表

| 平台 | 类型 | 常见 Host / 域名 | 典型 Path | Method / 传输 | 典型负载结构 | 识别优先级 |
|------|------|------------------|------------|----------------|--------------|------------|
| Sensors Data / 神策 | 商业平台 | 自定义 `server_url` 域名 | `/sa` | `POST` / `sendBeacon` | JSON，常见 `events / user / header` | 高 |
| Google Analytics | 商业平台 | `google-analytics.com`、`region1.google-analytics.com` | `/g/collect`、`/mp/collect`、`/collect` | `GET` / `POST` / `beacon` | query 或 body 参数 | 高 |
| 百度统计 | 商业平台 | `hm.baidu.com` 或代理域名 | `/hm.gif` | `GET` image beacon | query 参数 | 高 |
| GrowingIO | 商业平台 | 自定义采集域名 | 平台配置相关 | `POST` / `beacon` | JSON / 压缩字段 | 中 |
| Mixpanel | 商业平台 | `api.mixpanel.com` 或代理域名 | `/track`、`/engage`、`/import` | `GET` / `POST` | query / form / JSON | 中 |
| Amplitude | 商业平台 | `api2.amplitude.com` 等 | `/2/httpapi`、`/batch` | `POST` | JSON | 中 |
| Segment | 商业平台 | `api.segment.io` 或代理域名 | `/v1/track`、`/v1/batch`、`/v1/t`、`/v1/b` | `POST` | JSON | 中 |
| Matomo | 开源方案 | 自部署域名 | `/matomo.php` | `GET` / `POST` | query / form | 高 |
| Plausible | 开源方案 | 自部署或官方域名 | `/api/event` | `POST` / `beacon` | JSON | 高 |
| Umami | 开源方案 | 自部署域名 | `/api/send` | `POST` | JSON | 高 |
| PostHog | 开源 / 商业双形态 | `us.i.posthog.com`、自部署域名 | `/e`、`/batch`、`/capture` | `POST` | JSON | 高 |
| Adobe Analytics | 商业平台 | 自定义 tracking server | `/b/ss/...` | `GET` image | query 参数 | 低 |
| RudderStack | 开源 / 商业双形态 | 自定义 datastream host | `/v1/track`、`/v1/batch` | `POST` | JSON | 低 |
| 友盟+ | 商业平台 | 依接入方案而定 | 平台 SDK 相关 | `GET` / `POST` | 平台私有格式 | 低 |

### 5.4 重点平台细化说明

#### 5.4.1 Sensors Data / 神策

- 来源类型：官方文档可确认 + 公开集成特征
- 接入形态：
  - Web SDK 在初始化时会配置 `server_url`
  - 上报常见为 `POST` 或 `sendBeacon`
- 常见特征：
  - URL 通常包含 `/sa`
  - query 中常见 `project`
  - 请求体为 JSON
  - 典型结构包含 `events`、`user`、`header`
- 可提取关键字段：
  - `event`
  - `params`
  - `user_unique_id`
  - 本地时间或上报时间
- 识别策略：
  - `path` 命中 `/sa`
  - `query` 命中 `project`
  - `body` 命中 `events/user/header`

#### 5.4.2 Google

- 来源类型：官方文档可确认
- 重点覆盖：
  - `GA4 g/collect`
  - `Measurement Protocol mp/collect`
  - 遗留 `collect`
- 常见特征：
  - Host 为 `google-analytics.com` 或区域域名
  - 事件可能通过 `GET` query 或 `POST` body 上报
  - 常见字段有 `tid`、`cid`、`en`、`ep.*`
- 可提取关键字段：
  - measurement id / tracking id
  - client id
  - event name
  - event params
- 识别策略：
  - host 命中 Google Analytics 域名
  - path 命中 `/g/collect`、`/mp/collect`、`/collect`
  - query 或 body 中存在 Google 事件字段

#### 5.4.3 百度统计

- 来源类型：官方部署方式可确认 + 公开网络行为特征
- 常见特征：
  - 页面加载 `hm.js`
  - 上报请求通常是 `hm.gif`
  - 传输方式多为 image beacon
  - 参数大量体现在 query 中
- 可提取关键字段：
  - site id
  - 页面 URL
  - 来源 URL
  - 事件类型相关 query
- 识别策略：
  - host 命中 `hm.baidu.com` 或已知代理域名
  - path 命中 `/hm.gif`
  - 页面上下文存在 `hm.js`

#### 5.4.4 Matomo

- 来源类型：官方文档可确认
- 常见特征：
  - path 常为 `/matomo.php`
  - 可使用 `GET` 或 `POST`
  - 参数通常在 query/form 中
- 可提取关键字段：
  - `idsite`
  - `action_name`
  - `_id`
  - 事件分类、动作、名称、值

#### 5.4.5 Plausible

- 来源类型：官方文档可确认
- 常见特征：
  - path 常为 `/api/event`
  - 常用 `POST` 或 `sendBeacon`
  - 请求体 JSON 中含 `name`、`url`、`domain`、`props`

#### 5.4.6 Umami

- 来源类型：官方文档可确认
- 常见特征：
  - path 常为 `/api/send`
  - `POST` JSON
  - 常见字段有 `website`、`hostname`、`url`、`name`、`data`

#### 5.4.7 PostHog

- 来源类型：官方文档可确认
- 常见特征：
  - path 常见 `/e`、`/batch`、`/capture`
  - `POST` JSON
  - 字段常见 `event`、`distinct_id`、`properties`

#### 5.4.8 Segment

- 来源类型：官方文档可确认
- 常见特征：
  - 标准 HTTP API 为 `/v1/track`、`/v1/batch`
  - Web 代理模式常见短路径 `/v1/t`、`/v1/b`
  - 请求体 JSON 中常见 `event`、`userId`、`anonymousId`、`properties`

#### 5.4.9 Mixpanel / Amplitude / GrowingIO

- 来源类型：官方文档可确认 + 部分公开接入特征
- 处理策略：
  - 首版优先保证能识别平台和提取主事件名
  - 对复杂压缩字段、私有编码字段允许先保留原始值

---

## 6. 升级后系统架构

### 6.1 架构目标

升级后的系统必须把“平台识别”从单文件硬编码改为可维护的管理层机制。

### 6.2 整体架构图

```text
┌──────────────────────────────────────────────────────────────┐
│                         Web Page                             │
│                                                              │
│  fetch / XHR / sendBeacon / image request                    │
│  SDK scripts / init config / proxy host clues               │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                 Request Capture Layer                        │
│  Service Worker + chrome.webRequest                          │
│  ├─ onBeforeRequest                                          │
│  ├─ onSendHeaders                                            │
│  ├─ onCompleted / onErrorOccurred                            │
│  └─ requestId 级别关联                                       │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                 Platform Matcher Layer                       │
│  平台目录 + 规则适配器                                       │
│  ├─ host/path/query/body/pageContext 匹配                    │
│  ├─ confidence 评分                                          │
│  └─ unknown analytics fallback                               │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                  Normalization Layer                         │
│  统一数据模型                                                │
│  ├─ 请求体解码                                               │
│  ├─ query / form / JSON 解析                                 │
│  ├─ 事件字段归一化                                           │
│  └─ warnings / matchedBy / raw payload 保留                  │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                  Visualization Layer                         │
│  Panel UI                                                    │
│  ├─ 平台多选筛选                                             │
│  ├─ 平台 icon 展示                                           │
│  ├─ 统一事件卡片                                             │
│  ├─ 原始数据查看                                             │
│  └─ CSV 导出                                                 │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 目标模块划分

| 模块 | 文件形态 | 职责 |
|------|----------|------|
| Capture Orchestrator | `service-worker.js` | 统一监听请求、管理缓存、分发事件 |
| Platform Catalog | `platform-catalog.js` | 平台元数据、icon 路径、label、文档链接 |
| Platform Adapters | `platform-adapters.js` | 每个平台的 matcher / parser |
| Analytics Core | `analytics-core.js` | 通用解码、解析、规范化、辅助函数 |
| Page Context Collector | `content-script.js` | 收集页面 SDK 线索，不改写页面运行时 |
| Visualization | `panel.html/js/css` | 筛选、卡片展示、详情、导出 |

---

## 7. 数据模型设计

### 7.1 CapturedRequest

插件内部统一存储的请求对象定义如下：

```javascript
{
  id: "local-unique-id",
  requestId: "chrome-webRequest-requestId",
  timestamp: "2026-03-19T08:00:00.000Z",
  tabId: 123,
  frameId: 0,
  initiator: "https://example.com",
  url: "https://collector.example.com/sa?project=default",
  method: "POST",
  type: "fetch",
  query: { project: "default" },
  headers: [],
  contentType: "application/json",
  bodyRaw: "...",
  bodyParsed: {},
  status: 200,
  platform: "sensors",
  confidence: 0.98,
  matchedBy: ["path:/sa", "query:project", "body:events"],
  warnings: [],
  normalizedEvents: []
}
```

### 7.2 NormalizedEvent

统一事件模型定义如下：

```javascript
{
  platform: "google",
  eventName: "page_view",
  userId: "user_123",
  anonymousId: "cid_456",
  distinctId: "distinct_789",
  eventTime: "2026-03-19T08:00:01.000Z",
  properties: {
    page_location: "https://example.com",
    page_title: "首页"
  },
  rawEvent: {}
}
```

### 7.3 PlatformCatalogItem

平台目录项统一定义如下：

```javascript
{
  id: "posthog",
  label: "PostHog",
  iconPath: "images/platforms/posthog.svg",
  docsUrl: "https://posthog.com/docs/api/capture",
  matcher: function(request, pageContext) {},
  parser: function(request) {}
}
```

---

## 8. 核心链路设计

### 8.1 候选请求识别

首层不是直接按某个平台匹配，而是先筛出“像埋点”的请求，典型信号包括：

- 请求类型为 `fetch` / `xmlhttprequest` / `ping` / image
- URL path 命中常见采集路径
- query / body 命中常见埋点字段
- 页面上下文检测到已接入的 SDK 脚本

### 8.2 平台识别

平台识别采用评分机制，而不是单一字符串命中：

- `host` 命中：高权重
- `path` 命中：高权重
- `query/body` 特征：中权重
- `pageContext` 线索：辅助权重

评分最高且超过阈值的候选平台将被认定为当前请求所属平台；否则归类为 `unknown_analytics`。

### 8.3 请求关联

升级后统一使用 `requestId` 作为三段监听的关联主键：

- `onBeforeRequest`：创建请求记录
- `onSendHeaders`：补充请求头
- `onCompleted`：补充状态码
- `onErrorOccurred`：补充失败状态

这比当前按 URL 查找对象更稳定，可避免并发同 URL 请求的状态串联问题。

### 8.4 规范化解析

所有平台进入 UI 前先归一化：

- 提取事件名
- 提取用户标识
- 提取匿名标识
- 提取事件时间
- 提取属性对象
- 保留平台原始事件和请求原始载荷

解析失败时不丢弃请求，只在 `warnings` 中记录原因。

---

## 9. 前端展示与交互设计

### 9.1 首页顶部布局

首页顶部搜索区域升级为三段式布局：

```text
[ 平台多选下拉 ] [ 搜索框 ] [ like / not like ]
```

其中：

- 平台多选下拉固定放在搜索框左侧
- 平台多选支持 `All Platforms` 默认态
- 下拉选项以 `品牌 icon + 平台名 + 勾选状态` 展示

### 9.2 筛选逻辑

过滤顺序固定如下：

1. 平台多选过滤
2. 关键词 include / exclude 过滤
3. 渲染可见事件列表

平台筛选和关键词搜索必须可以叠加使用。

### 9.3 事件卡片

升级后的卡片头部包含：

- 平台品牌 icon
- 平台名称
- 主事件名
- 用户标识或匿名标识
- 请求状态码
- 时间

卡片详情区固定拆为四个 section：

1. **规范化事件**
2. **匹配依据**
3. **请求信息**
4. **原始载荷**

### 9.4 空状态与兼容策略

当当前页面没有识别到任何埋点时，继续展示现有空状态。

当识别到埋点但未成功解析时：

- 卡片仍然显示平台或 `Unknown Analytics`
- 原始请求和 URL 可查看
- `warnings` 可提示为什么未完全解析

---

## 10. 品牌素材资产方案

### 10.1 素材目录

新增素材目录：

```text
tea_event_radar/images/platforms/
```

目录中存放各平台品牌 SVG，例如：

- `google.svg`
- `baidu.svg`
- `sensors.svg`
- `matomo.svg`
- `plausible.svg`
- `umami.svg`
- `posthog.svg`
- `segment.svg`
- `mixpanel.svg`
- `amplitude.svg`
- `growingio.svg`
- `unknown.svg`

### 10.2 素材策略

素材策略按以下顺序执行：

1. 优先使用平台官方可公开引用的品牌素材
2. 无稳定官方素材时，回退到 Simple Icons 等可合法引用的 SVG
3. 全部素材统一尺寸、透明背景、风格规格

### 10.3 素材来源记录

为避免后续维护时丢失来源信息，需要新增：

```text
tea_event_radar/images/platforms/SOURCES.md
```

该文件记录：

- 平台名称
- 文件名
- 来源 URL
- 获取日期
- 许可或备注

---

## 11. 性能、稳定性与安全约束

### 11.1 性能约束

- 继续保留请求缓存上限
- UI 渲染继续采用防抖和批量渲染
- 平台识别优先使用轻量级匹配，避免对每个请求做过重解析
- 复杂 body 解析应在命中候选后再执行

### 11.2 稳定性约束

- 未识别平台不能导致整个消息流失败
- 单个平台解析器异常不能影响其他请求展示
- 面板关闭时允许后台继续缓存事件
- 面板未打开时消息发送失败应被静默处理

### 11.3 隐私与边界

- 插件只在本地浏览器内存中处理数据
- 不主动将采集到的埋点内容上报到第三方服务
- 不对页面请求做阻断、篡改或重放
- 当前权限模型继续基于 `webRequest + <all_urls>`

---

## 12. 测试与验收方案

### 12.1 平台识别测试

每个平台至少准备两类样例：

- 正常单事件
- 批量事件或异常格式

校验项：

- 是否识别到正确平台
- `matchedBy` 是否合理
- `confidence` 是否达阈值

### 12.2 解析测试

校验项：

- 主事件名是否提取正确
- 用户或匿名标识是否提取成功
- 事件属性是否结构化
- 无法解析的字段是否保留在原始数据中

### 12.3 UI 测试

校验项：

- 首页平台多选筛选位置正确，位于搜索框左侧
- 平台筛选和关键词搜索叠加后结果正确
- 平台 icon 在下拉和卡片头部都显示正常
- 窄面板宽度下顶部布局不溢出

### 12.4 链路测试

需要覆盖以下链路：

- `fetch` 请求
- `XMLHttpRequest`
- `sendBeacon`
- `GET image beacon`
- 失败请求与取消请求
- 同 URL 并发请求

### 12.5 验收样例

首版应至少在以下类型页面上完成验证：

- 神策接入页面
- Google Analytics 接入页面
- 百度统计接入页面
- Matomo / Plausible / Umami / PostHog 代表页面

---

## 13. 实施阶段建议

### Phase 1：文档与平台目录

- 完成本方案文档
- 建立平台目录和平台元数据结构
- 确定 icon 素材目录和命名规范

### Phase 2：中间层改造

- 将 `service-worker.js` 改为中间层 orchestrator
- 增加平台匹配器与通用解析核心
- 使用 `requestId` 进行事件关联

### Phase 3：统一视图与平台筛选

- 改造 `panel.html` 顶部结构
- 在 `panel.js` 中加入平台多选过滤状态
- 将卡片展示改成统一平台视图

### Phase 4：素材接入与验收

- 引入品牌 icon
- 接入平台目录和卡片展示
- 完成平台验证和 UI 验收

---

## 14. 风险与后续演进

### 14.1 主要风险

| 风险 | 说明 |
|------|------|
| 自定义采集域名 | 很多平台支持代理或自定义 host，仅靠域名识别不够 |
| 平台协议变更 | path、字段、压缩方式可能升级 |
| 私有编码字段 | 个别平台可能有压缩或编码参数，首版只能部分结构化 |
| 品牌素材维护 | 平台 logo 可能更新，需维护来源记录 |
| 面板宽度有限 | 多选筛选和关键词搜索共存时，布局易拥挤 |

### 14.2 演进方向

- 增加“仅看未解析请求”筛选
- 增加平台级统计与计数
- 增加自定义规则配置能力
- 增加请求导出为 JSON 的能力
- 增加页面已接入 SDK 的检测面板

---

## 15. 参考资料

以下资料用于支撑本方案中的平台识别和接口特征判断：

- Sensors Data Web SDK 文档：`https://manual.sensorsdata.cn/sa/docs/tech_sdk_client_web/v0300`
- Google Analytics GA4 Measurement Protocol：`https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference`
- GrowingIO Web SDK 文档：`https://docs.growingio.com/op/v/2.0/developer-manual/sdkintegrated/client-sdk-2.0/web-js-sdk`
- Matomo Tracking API：`https://developer.matomo.org/api-reference/tracking-api`
- Mixpanel Track API：`https://developer.mixpanel.com/reference/track-event`
- PostHog Capture API：`https://posthog.com/docs/api/capture`
- Umami Tracker 文档：`https://docs.umami.is/docs/tracker-functions`
- Segment HTTP API：`https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/server/http-api`

对于百度统计、Adobe Analytics、RudderStack、友盟+ 等未完全标准化公开的网络层细节，方案中的部分判断基于公开部署方式、官方接入代码和常见网络行为特征进行归纳，后续实现时应以真实抓包结果再做校验。
