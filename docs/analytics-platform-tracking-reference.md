# 主流埋点平台上报请求特征技术参考

> Status: Research Reference
> Source of truth: 官方文档 + 全网调研 + 网络抓包验证
> Last synced: 2026-03-20
> Freshness: 🟢 FRESH
> Scope: `SDK 加载机制` + `上报端点与协议` + `数据编码与压缩` + `Cookie/存储` + `批量发送与重试` + `反屏蔽策略` + `请求拦截识别`

---

## 1. 文档目的

本文档系统整理主流埋点/分析平台的网络上报请求特征，作为 Tea Event Radar 扩展后续拓展多平台拦截能力的技术参考。

覆盖内容包括：

- 各平台 SDK 加载方式与初始化机制
- 数据采集端点 URL 模式
- 请求发送方式（Image Beacon / XHR / sendBeacon / WebSocket）
- 数据编码与压缩格式（JSON / Base64 / Gzip / Protobuf）
- Cookie 与本地存储详情
- 批量发送队列、刷新间隔与重试机制
- 反广告拦截 / 自定义域名策略
- 请求拦截识别特征汇总

---

## 2. 神策 Sensors Data

### 2.1 SDK 加载方式

页面嵌入异步加载 `sensorsdata.min.js`，通过 `sensors.init()` 初始化，配置 `server_url` 指向数据接收服务。

全局变量：`sensorsDataAnalytic201505`

### 2.2 上报端点

| 部署模式 | 端点格式 | 说明 |
|---------|---------|------|
| 私有部署（≥1.7） | `https://{host}:8106/sa?project={project_name}` | 默认端口 8106 |
| 私有部署（≤1.7） | `https://{host}:8006/sa?project={project_name}` | 旧版端口 8006 |
| Cloud 服务 | `https://{name}.cloud.sensorsdata.cn:8106/sa?token={token}` | SaaS 云服务 |
| Cloud 新版 | `https://{name}.datasink.sensorsdata.cn/sa?token={token}` | HTTPS 443/4006 |

### 2.3 发送方式

通过 `send_type` 配置项控制：

| send_type | 方式 | 版本要求 | Content-Type | 说明 |
|-----------|------|---------|-------------|------|
| `image`（默认） | 1×1 GIF GET 请求 | 全版本 | 无自定义头 | 浏览器自动发送，无 CORS 问题 |
| `ajax` | XMLHttpRequest POST | v1.10+ | `text/plain` 或 `application/x-www-form-urlencoded` | 故意使用简单请求避免 CORS preflight |
| `beacon` | `navigator.sendBeacon()` POST | v1.10+（v1.15.26 正式支持） | `text/plain`（浏览器自动设置） | 需配合 `use_client_time: true` |

### 2.4 数据编码

**标准编码管线：**

```
JSON payload → Gzip 压缩 → Base64 编码 → URL Encode
→ POST body: data_list=<encoded>&gzip=1
   或单条: data=<encoded>&gzip=1
```

**加密扩展（可选插件）：**

| 插件 | 版本 | 说明 |
|------|------|------|
| AES 加密 | v1.19.9+ | 传输前加密 JSON，需 SDF 后端 2.3+ |
| SM4 国密加密 | v1.25.20+ | 中国国家标准对称加密，金融/政务场景 |
| Cookie 加密 | v1.16.10+ | 加密 `sensorsdata2015jssdkcross` Cookie 值 |
| localStorage 加密 | v1.21.9+ | 加密本地存储的队列数据 |

**type 字段区分事件类型：**

| type | 说明 |
|------|------|
| `track` | 事件追踪 |
| `track_signup` | 注册关联 |
| `profile_set` | 设置用户属性 |
| `profile_set_once` | 首次设置用户属性 |
| `profile_increment` | 数值属性累加 |
| `profile_append` | 列表属性追加 |
| `profile_delete` | 删除用户 |
| `profile_unset` | 删除用户属性 |

### 2.5 Cookie 详情

**主 Cookie：** `sensorsdata2015jssdkcross`

- **格式**：URL 编码的 JSON 字符串
- **域**：默认设置在根域（`cross_subdomain: true`），支持子域共享
- **过期时间**：360 天（v1.26.12 起，之前为 730 天）
- **SameSite**：v1.18.10+ 支持配置

**Cookie JSON 结构：**

```json
{
  "distinct_id": "当前活跃 ID（匿名或登录）",
  "first_id": "原始匿名 ID（login() 后填充）",
  "login_id": "用户登录 ID",
  "anonymous_id": "设备/浏览器生成的 UUID"
}
```

**跨域用户关联（SiteLinker 插件）：**
- 通过 URL 参数 `_sasdk=<distinctID>` 传递身份信息
- 支持 `after_hash: true` 将参数附加到 `#` 后

### 2.6 批量发送与队列

**Web SDK 批量模式（`batch_send` 配置）：**

```javascript
batch_send: {
  datasend_timeout: 6000,  // 请求超时 (ms)
  send_interval: 6000,     // 发送间隔 (ms)
  storage_length: 200      // localStorage 队列最大记录数
}
```

- 默认关闭（`batch_send: false`），每次 track 立即发送
- 使用 `localStorage` 作为写前日志缓冲
- 数据在确认发送成功后才从 localStorage 删除
- 队列超过 200 条时，最旧的 100 条被删除，新事件改用即时 image GET
- `$pageview` 和 `$SignUp` 事件会立即触发 flush

**移动端 SDK 批量配置：**

| 参数 | Android 默认值 | iOS 默认值 |
|------|-------------|-----------|
| flushInterval | 15 秒 | 15 秒 |
| flushBulkSize | 100 条 | 100 条 |
| 最大缓存 | 32 MB（SQLite） | 10,000 条（SQLite） |
| 网络策略 | WiFi/3G/4G/5G（排除 2G） | WiFi/3G/4G/5G |
| 后台自动 flush | 是 | 是 |

### 2.7 重试机制

| 模式 | 失败行为 |
|------|---------|
| `image` GET | 无重试，事件丢弃 |
| `ajax` POST（无 batch） | 事件丢弃（v1.25.19+ 支持成功/失败回调） |
| `ajax` POST（batch 模式） | 记录保留在 localStorage，下次 send_interval 重试 |
| `beacon` | sendBeacon 返回布尔值，实际投递由浏览器管理，无重试回调 |
| 移动端 | 失败记录保留在 SQLite，下次 flush 周期重试，无指数退避 |

### 2.8 反广告拦截

- `custom_server_url`（v1.27.8+）：配置自定义代理域名
- 推荐方案：Nginx 反向代理 `/sa` 请求到实际接收服务器
- `server_url` 本身接受任意 URL，可直接指向第一方代理

### 2.9 SDK 版本演进

| 版本 | 变更 |
|------|------|
| v1.10+ | 新增 `ajax` 和 `beacon` 发送方式 |
| v1.14.7 | localStorage 离线队列引入 |
| v1.16.10 | Cookie 加密 |
| v1.18.10 | SameSite Cookie 属性 |
| v1.19.9 | AES 传输加密插件 |
| v1.24.1 | 插件架构重构 |
| v1.25.20 | SM4 国密加密 |
| v1.26.9 | Cookie 移除 device_id 字段 |
| v1.26.12 | Cookie 过期 730→360 天 |
| v1.27.1 | v2 包移除内嵌插件（体积减少 ~25%） |
| v1.27.8 | `custom_server_url` 反屏蔽 |
| v1.27.11 | IndexedDB 队列插件 |

### 2.10 识别特征

```
域名/路径: URL 路径包含 /sa?project= 或 /sa?token=
JS 文件:   文件名包含 sensorsdata
全局变量:  sensorsDataAnalytic201505
Cookie:    sensorsdata2015jssdkcross
参数:      data_list= 或 data= 配合 gzip=1
```

---

## 3. Google Analytics（GA4 + 遗留版本）

### 3.1 GA4 客户端采集（gtag.js）

#### SDK 加载方式

通过 `gtag.js` 代码片段加载，自动采集 `page_view` 等事件。

#### 上报端点

| 端点 | 用途 |
|------|------|
| `https://www.google-analytics.com/g/collect` | GA4 自动采集（主） |
| `https://region1.google-analytics.com/g/collect` | EU 区域端点 |
| `/r/collect` | 启用广告功能时 |
| `https://www.google-analytics.com/debug/mp/collect` | 验证端点 |

#### 发送方式

- 默认使用 `navigator.sendBeacon()` / `fetch({ keepalive: true })` POST
- 支持 GET 请求，参数编码在 URL query string 中
- 参数以扁平化 key=value 编码，非 JSON 格式

#### 核心请求参数

**协议与身份参数：**

| 参数 | 名称 | 说明 |
|------|------|------|
| `v` | 协议版本 | GA4 固定为 `2` |
| `tid` | Measurement ID | 格式 `G-XXXXXXXXXX` |
| `cid` | Client ID | 来自 `_ga` Cookie |
| `uid` | User ID | 认证用户 ID |
| `_p` | 页面随机种子 | 每次页面加载生成，用于去重 |
| `_s` | 会话命中计数 | 当前会话内的累增序号 |
| `gtm` | GTM 容器哈希 | GTM 容器版本标识 |

**会话参数：**

| 参数 | 名称 | 说明 |
|------|------|------|
| `sid` | Session ID | 会话开始的 Unix 时间戳 |
| `sct` | Session Count | 用户历史总会话数 |
| `seg` | Session Engaged | `1`=参与（10s+ 活跃 / 2+ 页面 / 转化） |
| `_ss` | Session Start 标记 | 新会话首次命中时为 `1` |
| `_fv` | First Visit 标记 | 首次访问时为 `1` |

**事件与属性参数：**

| 参数 | 名称 | 说明 |
|------|------|------|
| `en` | 事件名 | 如 `page_view`, `click`, `purchase` |
| `ep.*` | 事件参数（字符串） | 如 `ep.page_title=Home`，每事件最多 25 个 |
| `epn.*` | 事件参数（数值） | 如 `epn.value=9.99` |
| `up.*` | 用户属性（字符串） | 如 `up.plan_type=premium` |
| `upn.*` | 用户属性（数值） | |
| `_et` | 参与时间 | 归属于此事件的活跃毫秒数 |

**页面与设备参数：**

| 参数 | 说明 |
|------|------|
| `dl` | 页面完整 URL |
| `dr` | Referrer |
| `dt` | 页面标题 |
| `ul` | 浏览器语言 |
| `sr` | 屏幕分辨率 |
| `vp` | 视口尺寸 |

**User-Agent Client Hints 参数：**

| 参数 | 说明 |
|------|------|
| `uaa` | 架构（如 `x86`） |
| `uab` | 位数（如 `64`） |
| `uafvl` | 完整版本列表 |
| `uamb` | 移动标记 |
| `uap` | 平台（如 `Windows`） |
| `uapv` | 平台版本 |

**Consent Mode 参数：**

| 参数 | 说明 |
|------|------|
| `gcs` | v1 同意状态：`G1xy`，x=ad_storage, y=analytics_storage（0=拒绝/1=同意） |
| `gcd` | v2 同意状态：编码四种信号（ad_storage/analytics_storage/ad_user_data/ad_personalization） |
| `_dbg` | 调试模式标记，值 `1` 时路由到 DebugView |

#### Cookie 详情

| Cookie | 格式 | 过期 | 说明 |
|--------|------|------|------|
| `_ga` | `GA1.<domain_level>.<random>.<timestamp>` | 2 年 | 主 Client ID，Safari ITP 下 JS 设置限 7 天 |
| `_ga_<STREAM_ID>` | GS2 格式（2025.5+）：`GS2.1.s<sid>$o<sn>$g<engaged>$t<ts>$j<join>$l<login>$h<hash>` | 2 年 | 会话状态（旧版为 GS1 固定位置格式） |
| `_gid` | — | 24 小时 | 短期会话标识（遗留） |
| `FPID` | — | 2 年 | 服务端 GTM 设置的 HttpOnly 第一方 ID |
| `FPLC` | — | 20 小时 | FPID 的哈希值，JS 可读，用于服务端跨域 |

**GS2 Cookie 字段含义：**

| 键 | 含义 |
|----|------|
| `s` | Session ID（Unix 时间戳） |
| `o` | Session 序号/计数 |
| `g` | 参与标记（0/1） |
| `t` | 最后交互时间戳 |
| `j` | Join 计时器 |
| `l` | 增强用户登录状态 |
| `h` | 增强用户 ID 哈希 |

#### 跨域追踪

GA4 通过 URL 参数 `_gl` 实现跨域：

```
_gl=1*<指纹>*_ga*<编码_ga值>*_ga_XXXXX*<编码会话值>
```

- 指纹 = CRC32(User-Agent + 时区偏移 + 语言 + 时间窗口) 的 base-36 编码
- 有效期约 2 分钟（两个 60 秒时间窗口）
- 验证同一浏览器生成和接收链接，防止 URL 分享劫持会话

#### 离线与重试

gtag.js **没有**内置离线队列或重试机制。网络不可用时事件静默丢弃。`workbox-google-analytics` 模块已废弃且不兼容 GA4。

#### 批量与限制

| 约束 | 限制 |
|------|------|
| Measurement Protocol 每请求最大事件数 | 25 |
| POST body 最大 | 130 KB |
| 事件参数名长度 | ≤40 字符 |
| 事件参数值长度 | ≤100 字符 |
| 用户属性名长度 | ≤24 字符 |
| 用户属性值长度 | ≤36 字符 |

#### 识别特征

```
路径匹配:  /g/collect（GA4）、/mp/collect（Measurement Protocol）
参数:      v=2, tid=G-XXXXXXX
域名:      www.google-analytics.com 或 region1.google-analytics.com
Cookie:    _ga, _ga_XXXXXXX
调试:      _dbg=1
```

### 3.2 GA4 Measurement Protocol（服务端）

**端点：**
- `POST https://www.google-analytics.com/mp/collect?measurement_id=G-XXXX&api_secret=XXXX`
- EU：`POST https://region1.google-analytics.com/mp/collect`

**数据格式：**

```json
{
  "client_id": "xxx",
  "events": [
    {
      "name": "event_name",
      "params": { "key": "value" }
    }
  ]
}
```

### 3.3 Universal Analytics（已停用，遗留兼容）

**端点：**
- `https://www.google-analytics.com/collect`（单条）
- `https://www.google-analytics.com/batch`（批量）

**发送方式：** GET query string 或 POST body，参数格式 `v=1&t=pageview&tid=UA-XXXXX-X&cid=xxx`

**识别特征：** URL 路径 `/collect` 且参数含 `v=1`、`tid=UA-`

---

## 4. 百度统计

### 4.1 SDK 加载方式

动态创建 `<script>` 加载 `https://hm.baidu.com/hm.js?{统计ID}`。写入第三方 Cookie `HMACCOUNT`。

### 4.2 上报端点

`https://hm.baidu.com/hm.gif?{params}` — 1×1 透明 GIF（GET Image Beacon）

### 4.3 请求触发模式

**每次页面访问产生多次请求：**

1. 加载 `hm.js?{统计ID}` 获取 JS 脚本
2. 首次 `hm.gif` 请求（页面进入，`ep=0`）
3. 第二次 `hm.gif` 请求（携带更多上下文）
4. 页面退出时 `hm.gif` 请求（`ep` 记录停留时长，如 `ep=7289,115`）

### 4.4 完整参数列表

| 参数 | 含义 |
|------|------|
| `si` | 统计代码 ID（32 位十六进制，标识站点） |
| `su` | 上一页 referrer |
| `ds` | 屏幕尺寸（如 `1440x900`） |
| `cl` | 颜色深度（如 `32-bit`） |
| `ln` | 语言（如 `zh-cn`） |
| `ep` | 页面停留时间（毫秒，两个逗号分隔值：总时间与最后活跃间隔） |
| `et` | 事件类型标记 |
| `lt` | Unix 时间戳（页面加载时间，秒） |
| `rnd` | 10 位随机数（防缓存） |
| `v` | SDK 版本号（如 `1.2.30`） |
| `ck` | 是否支持 Cookie（1/0） |
| `cc` | Cookie 计数，通常为 `1` |
| `fl` | Flash 版本 |
| `ja` | Java 支持（1/0） |
| `nv` | 导航类型标记 |
| `sb` | 特殊浏览器标识（如 `17` = 360 安全浏览器） |
| `se` | 搜索引擎标识编码 |
| `sw` | 搜索词 |
| `cf` | Campaign 来源（URL 参数 `hmsr`） |
| `ci` | Campaign ID（URL 参数 `hmci`） |
| `cm` | Campaign 媒介（URL 参数 `hmmd`） |
| `cp` | Campaign 投放位置（URL 参数 `hmpl`） |
| `cw` | Campaign 关键词（URL 参数 `hmkw`） |
| `lo` | Logout 标记 |

### 4.5 Cookie 与存储详情

**第三方 Cookie（`.hm.baidu.com` 域）：**

| Cookie | 过期 | 说明 |
|--------|------|------|
| `HMACCOUNT` | 2038 年（永久） | 主用户标识，Secure 标记，跨站点共享 |
| `HMACCOUNT_BFESS` | — | 百度搜索环境变体，跨产品归因 |

**第一方 Cookie（站点域）：**

| Cookie | 过期 | 说明 |
|--------|------|------|
| `Hm_lvt_{siteid}` | 1 年 | 最近 4 次访问时间戳（逗号分隔 Unix 时间戳） |
| `Hm_lpvt_{siteid}` | Session | 当前页面浏览时间戳 |

**存储冗余机制：**

百度统计将 `Hm_lvt` 和 `Hm_lpvt` 值同时镜像到 `localStorage` 和 `sessionStorage`。即使 Cookie 被清除，localStorage 仍保留访问历史。这使得百度的追踪比 GA4 的纯 Cookie 方案更具弹性。

### 4.6 事件追踪 API

```javascript
_hmt.push(['_trackEvent', category, action, opt_label, opt_value]);
```

事件参数编码到 `hm.gif` 请求的 query string 中，`et` 参数区分事件与 PV。

**自定义变量：**

```javascript
_hmt.push(['_setCustomVar', index, name, value, opt_scope]);
// index: 1-5, scope: 1=访客级, 2=访问级, 3=页面级(默认)
```

### 4.7 SPA 支持

- **手动方式：** `_hmt.push(['_trackPageview', '/#' + to.fullPath])`
- **UrlChangeTracker 插件：** 自动检测 `hashchange` 和 `pushState`/`replaceState`
- **后台设置：** 百度统计 UI 中开启「启用单页应用数据统计」

### 4.8 跨域追踪

百度统计**没有**内置跨域链接器。跨站点用户识别完全依赖第三方 Cookie `HMACCOUNT`。随着第三方 Cookie 逐步淘汰，此机制面临风险。

### 4.9 批量与重试

- Web SDK **不使用**批量队列，每个 PV/事件独立发送一个 `hm.gif` 请求
- 无离线队列或重试机制，请求失败则数据丢失
- 移动端 SDK（`mtj.baidu.com`）使用 SQLite 本地数据库，每 5 分钟批量上传

### 4.10 反广告拦截

百度统计**不提供**官方自定义域名/第一方代理功能。`hm.baidu.com/hm.js` 和 `hm.baidu.com/hm.gif` 均在主流广告拦截列表中。

### 4.11 识别特征

```
域名:   hm.baidu.com
路径:   /hm.gif 或 /hm.js
参数:   si=（32 位十六进制统计 ID）
Cookie: HMACCOUNT, Hm_lvt_*, Hm_lpvt_*
```

---

## 5. GrowingIO

### 5.1 SDK 加载方式

Web 端集成 JS SDK，支持无埋点（autotrack）+ 代码埋点。

**全局对象：** SDK 2.x 使用 `window.gio`，SDK 4.x 使用 `window.gdp`

**无埋点机制：** SDK 在 document 级别注册全局事件委托监听器，捕获 `click`、`change`、`submit`、`touchstart/touchend`、`hashchange`、`popstate`，并通过原型覆盖拦截 `pushState`/`replaceState`。使用 XPath 定位交互元素（精确路径 + 近似路径），支持圈选（可视化全埋点配置）。

**自定义 DOM 属性：**

| 属性 | 说明 |
|------|------|
| `data-growing-container` | 指定为命名容器边界 |
| `data-growing-title` | 覆盖计算文本标签 |
| `data-growing-idx` | 分配列表位置索引 |
| `data-growing-ignore="true"` | 排除该元素及子元素 |
| `data-growing-track="true"` | 启用输入字段文本捕获 |

### 5.2 上报端点

| 模式 | 端点 | 说明 |
|------|------|------|
| NewSaaS（当前） | `https://napi.growingio.com/v3/projects/{accountId}/collect` | SDK 3.x/4.x 默认 |
| SaaS（遗留 2.x） | `https://api.growingio.com/v2/{projectId}/events` | 旧版 |
| CDP / 私有部署 | 自定义 `dataCollectionServerHost` | 同 v3 路径 |
| 服务端 | `https://api.growingio.com/v3/{project_id}/s2s/cstm` | 服务端事件 |

### 5.3 事件类型与载荷

**SDK 3.x/4.x 事件类型：**

| eventType | 说明 |
|-----------|------|
| `VISIT` | 新会话开始 |
| `PAGE` | 页面浏览 |
| `VIEW_CLICK` | 自动追踪元素点击 |
| `VIEW_CHANGE` | 输入/选择变更 |
| `FORM_SUBMIT` | 表单提交 |
| `CUSTOM` | 开发者通过 `gdp('track', name, props)` 触发 |
| `LOGIN_USER_ATTRIBUTES` | 用户属性设置 |

**通用基础字段：**

```json
{
  "eventType": "VIEW_CLICK",
  "timestamp": 1700000000000,
  "domain": "www.example.com",
  "path": "/product/123",
  "query": "?ref=nav",
  "title": "Product Page",
  "sessionId": "abc123",
  "userId": "anonymous_device_id",
  "deviceId": "persistent_device_id",
  "platform": "Web",
  "sdkVersion": "4.3.1",
  "dataSourceId": "ds_id",
  "attributes": {}
}
```

### 5.4 数据编码

| SDK 版本 | 编码方式 |
|---------|---------|
| 2.x | JSON + Gzip 压缩 |
| 3.x/4.x 默认 | JSON + Gzip，`Content-Type: application/json` |
| 3.x/4.x 可选 | Protobuf（`useProtobuf: true`），`Content-Type: application/x-protobuf` |
| 3.x/4.x 可选 | Snappy 压缩（`compressEnabled: true`）叠加 Protobuf |
| 移动端可选 | XOR / AES-128 加密 |

### 5.5 Cookie 详情

| Cookie | 过期 | 说明 |
|--------|------|------|
| `grwng_uid` | 1 年 | 持久设备/用户标识（主匿名 ID） |
| `grwng_sid` | Session | 会话标识，30 分钟不活跃后重新生成 |
| `gr_user_id` | 1 年 | 登录用户 ID 镜像 |
| `growing_uid` | 1 年 | 旧版 1.x/2.x，3.x+ 已弃用 |

SDK 3.x+ 同时使用 `localStorage` 持久化 deviceId、userId 和事件队列。

### 5.6 批量发送

- 使用 localStorage 维护本地队列
- 定时刷新每 10-15 秒（可配置），或队列达到大小阈值
- 页面卸载时使用 `navigator.sendBeacon()` 刷新
- 失败请求重新入队，下次 flush 周期重试

### 5.7 反广告拦截

```javascript
// SDK 4.x
gdp('init', accountId, dataSourceId, appId, {
  dataCollectionServerHost: 'https://analytics.yourcompany.com'
});

// SDK 2.x
_vds.push(["setTrackerHost", "ubt.yourcompany.com"]);
```

GrowingIO 还提供 **Growing HUB** 自托管中继服务，部署在客户服务器上接收 SDK 事件并转发。

### 5.8 混合 H5-Native 桥接

Native SDK 向 WebView 注入 `window.GrowingWebViewBridge` JavaScript 桥接对象，H5 SDK 通过 `gio('getGioInfo')` 获取 Native 会话的 `sessionId`、`deviceId`、`userId`，以查询字符串形式附加到 WebView URL。

### 5.9 识别特征

```
域名:     growingio.com 或 napi.growingio.com
路径:     /v3/ 或 /v2/
全局对象:  window.gdp (4.x) 或 window.gio (2.x/3.x)
Cookie:   grwng_uid, grwng_sid
负载字段:  projectId, eventType, dataSourceId
```

---

## 6. Mixpanel

### 6.1 SDK 加载方式

通过 JS SDK（npm 或 CDN snippet）初始化，配置 `token`。

### 6.2 上报端点

| 端点 | 用途 |
|------|------|
| `POST https://api-js.mixpanel.com/track/` | 事件追踪 |
| `POST https://api-js.mixpanel.com/engage/` | 用户属性 |
| `POST https://api-js.mixpanel.com/groups/` | 分组属性 |
| `POST https://api.mixpanel.com/import` | 批量导入（历史数据） |
| `POST https://api-js.mixpanel.com/record/` | Session Replay |
| EU：`https://api-eu.mixpanel.com/` | EU 区域 |

### 6.3 发送方式

- JS SDK 默认 POST（XHR），支持 `sendBeacon`（页面卸载）
- 默认批量发送（`batch_requests: true`）

### 6.4 批量配置

| 配置键 | 默认值 | 说明 |
|--------|--------|------|
| `batch_requests` | `true` | 启用批量 |
| `batch_size` | 50 | 每请求最大事件数 |
| `batch_flush_interval_ms` | 5000 (5s) | 刷新间隔 |
| `batch_request_timeout_ms` | 90000 (90s) | 请求超时 |

- 队列满或间隔到期（先到先触发）
- 页面卸载时自动 flush
- 移动端默认 60 秒 flush 间隔

### 6.5 数据格式

**`/track` 请求：**

```json
[{
  "event": "Page View",
  "properties": {
    "token": "YOUR_TOKEN",
    "distinct_id": "user123",
    "time": 1234567890,
    "$device_id": "device_uuid",
    "$browser": "Chrome",
    "custom_property": "value"
  }
}]
```

**`/engage` 请求：**

```json
[{
  "$token": "YOUR_TOKEN",
  "$distinct_id": "user123",
  "$set": { "email": "user@example.com", "plan": "pro" }
}]
```

注意：`/track` 的 token 在 `properties` 内，`/engage` 的 `$token` 在顶层。

### 6.6 Cookie / 本地存储

**Cookie 名格式：** `mp_<TOKEN>_mixpanel`

- 值为 URI 编码的 JSON
- 默认 365 天过期，跨子域共享
- 存储 `distinct_id`、`$device_id`、`$user_id`、Super Properties、`$initial_referrer`、UTM 参数、opt-out 状态

**持久化选项：** `cookie`（默认）/ `localStorage` / `disable_persistence`（禁用所有）

### 6.7 Session Replay

- 基于 **rrweb** 开源 DOM 录制库
- 每 10 秒 flush 到服务器
- 使用浏览器 `CompressionStream` API（gzip/deflate）异步压缩
- `Content-Type: application/octet-stream`
- 默认遮盖所有文本和输入

### 6.8 代理支持

```javascript
mixpanel.init("TOKEN", {
  api_host: "https://your-proxy-domain.com"
});
```

官方提供 [tracking-proxy](https://github.com/mixpanel/tracking-proxy) nginx 配置。

### 6.9 重试与限流

- 网络失败后使用退避重试，移动端默认最多 5 次
- 速率限制：2 GB 未压缩 JSON/分钟（~30k events/s），429 响应触发退避
- 每请求最大 2000 事件或 10 MB

### 6.10 识别特征

```
域名:     api-js.mixpanel.com 或 api.mixpanel.com
路径:     /track/, /engage/, /groups/, /record/
Cookie:   mp_*_mixpanel
负载:     properties 中含 token, distinct_id, $browser
```

---

## 7. Segment

### 7.1 SDK 加载方式

Analytics.js snippet 异步加载，从 `cdn.segment.com` 拉取配置。

加载流程：
1. Snippet 在 `<head>` 中 stub `window.analytics`，缓冲调用
2. 请求 `https://cdn.segment.com/v1/projects/<WRITE_KEY>/settings` 获取启用的目的地配置
3. 加载 Analytics.js 核心库
4. 设备模式目的地的第三方 SDK 懒加载

### 7.2 上报端点

| 端点 | 用途 |
|------|------|
| `POST https://api.segment.io/v1/t` | track |
| `POST https://api.segment.io/v1/p` | page |
| `POST https://api.segment.io/v1/i` | identify |
| `POST https://api.segment.io/v1/batch` | 批量 |
| EU：`POST https://events.eu1.segmentapis.com/v1/...` | EU 区域 |

### 7.3 发送方式与认证

- POST 请求，`Content-Type: application/json`
- Basic Auth：`Authorization: Basic base64(<WRITE_KEY>:)`（用户名=writeKey，密码为空）
- 支持 `sendBeacon`（页面卸载时自动启用）

### 7.4 批量配置

```javascript
analytics.load("WRITE_KEY", {
  integrations: {
    "Segment.io": {
      deliveryStrategy: {
        strategy: "batching",
        config: { size: 10, timeout: 5000 }
      }
    }
  }
});
```

- 最大载荷 500 KB/批次，单事件 32 KB
- 批量大小 1-400 事件

### 7.5 数据格式

标准化 JSON，包含 `type`、`userId`/`anonymousId`、`properties`/`traits`、`context`、`timestamp`、`messageId`。

### 7.6 Cookie / 本地存储

| 存储键 | 类型 | 过期 | 说明 |
|--------|------|------|------|
| `ajs_anonymous_id` | Cookie + localStorage | 1 年 | UUID v4 匿名 ID |
| `ajs_user_id` | Cookie + localStorage | 1 年 | identify() 设置的 userId |
| `ajs_user_traits` | localStorage | 无过期 | 最后 identify() 的 traits JSON |
| `ajs_group_id` | Cookie + localStorage | 1 年 | Group ID |

存储优先级：localStorage → Cookie → 内存

### 7.7 设备模式 vs 云模式

| 方面 | 设备模式 | 云模式 |
|------|---------|--------|
| 请求目标 | 目的地自有端点 | `api.segment.io` |
| SDK 加载 | 加载第三方 SDK | 仅 Segment SDK |
| 数据转换 | 目的地原生 | Segment 映射层 |

### 7.8 重试队列

使用 `@segment/localstorage-retry` 包：
- localStorage 写前日志，内存 fallback
- 指数退避重试（`minRetryDelay` ~ `maxRetryDelay`）
- 最大队列 100 事件，最多重试 10 次
- 多标签页协调：tab 超 10 秒未更新 ack 时间戳，其他 tab 接管队列

### 7.9 识别特征

```
域名:    api.segment.io 或 cdn.segment.com
路径:    /v1/t, /v1/p, /v1/i, /v1/batch
认证:    Authorization: Basic (writeKey)
CDN:     cdn.segment.com/v1/projects/{WRITE_KEY}/settings
Cookie:  ajs_anonymous_id, ajs_user_id
负载:    anonymousId, writeKey, messageId
```

---

## 8. Amplitude

### 8.1 上报端点

| 端点 | 用途 |
|------|------|
| `POST https://api2.amplitude.com/2/httpapi` | HTTP V2 API（标准） |
| `POST https://api2.amplitude.com/batch` | Batch API |
| `POST https://api2.amplitude.com/identify` | Identify API |
| `POST https://api2.amplitude.com/groupidentify` | Group Identify |
| EU：`POST https://api.eu.amplitude.com/2/httpapi` | EU 区域 |

### 8.2 数据格式

```json
{
  "api_key": "YOUR_API_KEY",
  "events": [
    {
      "user_id": "12345",
      "device_id": "C8F9E604-...",
      "event_type": "watch_tutorial",
      "time": 1396381378123,
      "session_id": 1396381378000,
      "event_properties": { "source": "notification" },
      "user_properties": { "$set": { "age": 25 } },
      "platform": "iOS",
      "country": "United States"
    }
  ]
}
```

**Identify 请求** 使用 `application/x-www-form-urlencoded`：
```
api_key=YOUR_KEY&identification=[{"user_id":"user123","user_properties":{"$set":{"plan":"pro"}}}]
```

也可通过 HTTP V2 发送 `event_type: "$identify"` 事件。

### 8.3 Cookie / 本地存储

**Cookie 名格式：** `AMP_<API_KEY前10字符>`（如 `AMP_a2dbce0e18`）

- 旧版（JS SDK 1.x）：`amp_<6字符>`
- 点分隔编码：`deviceId.userId(base64).sessionId.lastEventTime.lastEventId`

**营销归因 Cookie：** `AMP_MKTG_<API_KEY前10字符>` — 存储 UTM 参数和 referrer

**localStorage：** `AMP_unsent_<api_key>` — 失败事件离线队列

### 8.4 批量队列

| 配置 | 默认值 |
|------|--------|
| `flushQueueSize` | 30 事件 |
| `flushIntervalMillis` | 1000 ms |

**离线模式（SDK 2.4.0+）：**
- 每次 `.track()` 检查 `navigator.onLine`
- 离线时保存到 `AMP_unsent_*` localStorage
- 监听 `online` 事件自动重新 flush

### 8.5 会话管理

- Session ID = 会话开始的 Unix 时间戳（毫秒）
- 默认超时 30 分钟不活跃
- Cookie 存储 `lastEventTime`，间隔超过超时则新建会话

### 8.6 ID 验证

- `device_id` 和 `user_id` 最少 5 字符
- 不足 5 字符的 ID 被静默移除（事件仍处理，只是缺少该 ID）
- 可通过 `minIdLength` 配置覆盖

### 8.7 限制

| 约束 | 限制 |
|------|------|
| 每请求最大事件数 | 2000 |
| 每请求最大大小 | 1 MB |
| 建议每批 | ≤10 事件 |
| 速率限制 | 100 批次/秒，1000 事件/秒 |
| 用户/设备节流 | 30 事件/秒 |

### 8.8 识别特征

```
域名:    api2.amplitude.com 或 api.amplitude.com
路径:    /2/httpapi, /batch, /identify, /groupidentify
Cookie:  AMP_*, AMP_MKTG_*
负载:    必含 api_key 和 events 数组
```

---

## 9. 开源方案

### 9.1 Matomo（前身 Piwik）

#### 上报端点

| 端点 | 说明 |
|------|------|
| `https://{domain}/matomo.php` | 新版追踪端点 |
| `https://{domain}/piwik.php` | 向后兼容 |
| `https://{domain}/js/` | 脚本服务端点 |

#### 发送方式

- 单条：GET 或 POST 到 `matomo.php`
- 批量：POST JSON body 到 `matomo.php`

**批量格式：**

```json
{
  "requests": [
    "?idsite=1&rec=1&action_name=Test&url=https://example.com",
    "?idsite=1&rec=1&action_name=Page2&url=https://example.com/page2"
  ],
  "token_auth": "xxx"
}
```

#### 核心参数

| 参数 | 说明 |
|------|------|
| `idsite`（必需） | 站点 ID |
| `rec=1`（必需） | 启用追踪 |
| `action_name` | 页面标题 |
| `url` | 当前页面 URL |
| `_id` | 访客 ID（16 位十六进制） |
| `rand` | 随机数防缓存 |
| `e_c / e_a / e_n / e_v` | 事件 category/action/name/value |
| `dimension{N}` | 自定义维度（如 `dimension1=Premium User`） |
| `ping=1` | 心跳请求（不记录新动作，仅更新停留时间） |
| `c_n / c_p / c_t / c_i` | 内容追踪：名称/片段/目标/交互类型 |

#### Cookie 详情

所有 Cookie 均为第一方，非 HttpOnly：

| Cookie | 过期 | 格式/说明 |
|--------|------|---------|
| `_pk_id.{siteId}.{hash}` | 13 个月 | `{visitorId}.{firstVisitTime}.{visitCount}.{lastVisitTime}.{lastActionTime}` |
| `_pk_ses.{siteId}.{hash}` | 30 分钟 | 会话标记，值为 `1` |
| `_pk_ref.{siteId}.{hash}` | 6 个月 | Campaign/referrer 归因 JSON 数组 |
| `_pk_consent` | — | 同意状态持久化（`rememberConsentGiven()` 设置） |

#### 心跳机制

```javascript
_paq.push(['enableHeartBeatTimer', 15]); // 最小 5 秒
```

- 不是周期性发送 ping，而是在用户离开页面时（标签切换、导航、关闭）且活跃时间超过阈值时触发
- 请求附加 `ping=1`，不记录新 PV，仅更新停留时间
- 使用 `visibilitychange` 和 `beforeunload` 事件

#### 同意机制

- `requireConsent()`：阻止**所有**追踪请求，直到 `setConsentGiven()` 调用
- `requireCookieConsent()`：请求仍发送但**不设置** Cookie，使用指纹识别

#### SPA 支持

```javascript
_paq.push(['setCustomUrl', window.location.href]);
_paq.push(['setDocumentTitle', document.title]);
_paq.push(['trackPageView']);
```

Matomo Tag Manager 支持 `History Change` 触发器。

#### 反广告拦截

官方 [matomo-org/tracker-proxy](https://github.com/matomo-org/tracker-proxy) PHP 代理。避免在代理 URL 中使用 "matomo" 或 "piwik"（已在拦截列表中）。

#### 识别特征

```
路径:    matomo.php 或 piwik.php
参数:    idsite= 和 rec=1（必需）
JS:     matomo.js 或 piwik.js
Cookie:  _pk_id.*, _pk_ses.*
```

---

### 9.2 Plausible

#### SDK 加载

```html
<script src="https://plausible.io/js/script.js" data-domain="your-site.com"></script>
```

极轻量（<1KB），无 Cookie 设计。

#### 脚本扩展变体

Plausible 使用模块化扩展系统，文件名拼接（顺序无关），可组合出 1024 种变体：

| 扩展 | 功能 |
|------|------|
| `hash` | 追踪 `#hash` 片段为独立页面 |
| `outbound-links` | 追踪外部链接点击 |
| `file-downloads` | 自动追踪文件下载（pdf, xlsx, zip 等） |
| `tagged-events` | 通过 CSS class `plausible-event-name=...` 追踪 |
| `exclusions` | 通过 localStorage 自我排除 |
| `compat` | IE11 兼容（XHR 替代 fetch） |
| `local` | 允许 localhost 追踪 |
| `manual` | 禁用自动 PV，手动调用 `plausible('pageview')` |
| `pageview-props` | PV 携带自定义属性 |
| `revenue` | 启用收入追踪字段 |

示例：`/js/script.hash.outbound-links.revenue.js`

#### 上报端点与数据格式

```
POST https://plausible.io/api/event
Content-Type: application/json
```

**Pageview 请求：**

```json
{
  "name": "pageview",
  "url": "https://example.com/page",
  "domain": "example.com",
  "referrer": "https://google.com"
}
```

**自定义事件请求：**

```json
{
  "name": "Signup",
  "url": "https://example.com/page",
  "domain": "example.com",
  "props": { "plan": "premium" }
}
```

**收入追踪：**

```json
{
  "name": "Purchase",
  "url": "https://example.com/checkout",
  "domain": "example.com",
  "revenue": { "currency": "USD", "amount": "49.99" }
}
```

#### 无 Cookie 追踪机制

```
daily_salt + domain + IP + User-Agent → SHA-256 → visitor_hash
```

- `daily_salt` 每 24 小时轮换，旧 salt 永久删除
- 同一访客同一天 = 同一哈希 = 一个唯一访客
- 原始 IP 和 User-Agent **从不写入**日志、数据库或磁盘

**必需 HTTP 头：**
- `User-Agent`：用于设备检测和用户哈希计算
- `X-Forwarded-For`：通过代理时设置真实 IP

#### 代理配置

支持 Netlify、Vercel、Cloudflare Workers 等官方代理指南，核心是将 `/js/script.js` 和 `/api/event` 通过自有域名代理。

#### 识别特征

```
路径:     /api/event（数据）、/js/script.js（脚本，可含扩展后缀）
脚本属性:  data-domain
无 Cookie、无 token 参数
```

---

### 9.3 Umami

#### SDK 加载

```html
<script src="https://{instance}/script.js" data-website-id="xxx"></script>
```

约 2KB，无 Cookie 设计。v2 脚本文件名从 `umami.js` 改为 `script.js`。

#### 上报端点

| 版本 | 端点 |
|------|------|
| v2（当前） | `POST https://{instance}/api/send` |
| v1（旧版） | `POST https://{instance}/api/collect` |

可通过环境变量 `COLLECT_API_ENDPOINT` 自定义。

#### 数据格式

```json
{
  "payload": {
    "hostname": "example.com",
    "language": "en-US",
    "referrer": "https://google.com",
    "screen": "1920x1080",
    "title": "Home Page",
    "url": "/",
    "website": "your-website-uuid",
    "name": "signup-button",
    "data": {
      "plan": "newsletter",
      "user_id": 123
    }
  },
  "type": "event"
}
```

- Pageview：`type: "event"`，无 `name` 或 `data` 字段
- 自定义事件：包含 `name` 和可选 `data`
- 数据约束：字符串最长 500 字符，最多 50 个顶级属性

#### 机器人检测

使用 `isbot` npm 包服务端检测。匹配 bot User-Agent 时返回 `{"beep":"boop"}`，数据不存储。无 User-Agent 头的请求被拒绝。

#### 反广告拦截

| 环境变量 | 说明 |
|---------|------|
| `TRACKER_SCRIPT_NAME` | 重命名脚本文件名（如 `analytics.js`） |
| `COLLECT_API_ENDPOINT` | 自定义上报路径 |

#### 缓存与性能

- 脚本 `Cache-Control: public, max-age=86400, stale-while-revalidate=86400`
- `data-cache` HTML 属性启用 sessionStorage 客户端缓存

#### 识别特征

```
路径:     /api/send（v2）、/api/collect（v1）
脚本属性:  data-website-id
负载:     website 字段（UUID 格式）
无 Cookie
```

---

### 9.4 PostHog

#### 上报端点

| 端点 | 用途 |
|------|------|
| `POST /i/v0/e` | 事件采集（新版） |
| `POST /capture` 或 `/capture/` | 事件采集（旧版兼容） |
| `POST /batch/` | 批量上报 |
| `POST /s/` | Session Replay |
| `POST /decide?v=3` | Feature Flags + 配置 |
| `GET /array/{token}/config` | 远程配置 |
| US Cloud：`https://us.i.posthog.com` | |
| EU Cloud：`https://eu.i.posthog.com` | |

#### 数据格式

**事件采集：**

```json
{
  "api_key": "phc_xxx",
  "event": "$pageview",
  "properties": {
    "distinct_id": "user123",
    "$current_url": "https://example.com",
    "$browser": "Chrome"
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

**批量格式：**

```json
{
  "api_key": "phc_xxx",
  "batch": [
    { "event": "event1", "properties": {...} },
    { "event": "event2", "properties": {...} }
  ]
}
```

#### Autocapture（自动捕获）

自动捕获 `$autocapture` 事件，监听 `click`、`change`、`submit` 在交互元素上。

载荷包含 `$elements` 数组（从目标元素到根的 DOM 层次结构，含 tag_name、classes、属性、文本）和 `$elements_chain` 点表示法字符串。

**配置选项：**
- `dom_event_allowlist`：限制特定 DOM 事件
- `element_allowlist`：限制特定标签名
- `css_selector_allowlist`：仅捕获匹配 CSS 选择器的元素
- `element_attribute_ignorelist`：忽略特定属性

#### Feature Flags（`/decide?v=3`）

请求：

```json
{
  "token": "phc_xxxxx",
  "distinct_id": "user_123",
  "groups": {"company": "company_id"},
  "person_properties": {"plan": "premium"}
}
```

响应包含 `featureFlags`、`featureFlagPayloads`、`sessionRecording` 配置、`capturePerformance` 等。

#### Session Replay（`/s/`）

基于 **rrweb** DOM 录制：
- `type: 2`：全量 DOM 快照（会话开始/导航时）
- `type: 3`：增量快照（突变、鼠标移动、滚动、输入）
- `type: 5`：自定义事件（控制台日志、网络请求）
- 存储格式：换行分隔 JSON `[windowId, rrwebEvent]\n...`

#### 压缩选项

| 选项 | 状态 |
|------|------|
| `gzip-js` | 当前使用，浏览器 Compression Streams API |
| `lz64` | v2.0 已移除（膨胀库体积） |
| `base64` | gzip 不可用时的 fallback |

#### Web Vitals 追踪

```javascript
posthog.init('phc_xxxxx', { capture_performance: true });
```

发送 `$web_vitals` 事件，包含 `$web_vitals_LCP_value`、`$web_vitals_FID_value`/`$web_vitals_INP_value`、`$web_vitals_CLS_value`、`$web_vitals_FCP_value`。SDK 等待页面加载后最多 5 秒收集指标。

#### Dead Click 检测

监听点击后通过 `MutationObserver` 观察 DOM 变化。~750ms 内无有意义突变则分类为 `$dead_click` 事件。

#### 队列与重试

- 内存 `_send_queue` 队列
- 页面卸载时 `sendBeacon` flush
- 失败请求（网络错误/5xx）重新入队，指数退避
- 尊重 `X-Retry-Later` 响应头

#### 识别特征

```
路径:    /i/v0/e, /capture, /batch/, /decide/, /s/
域名:    posthog.com 或 i.posthog.com
负载:    api_key（以 phc_ 开头）或 token
压缩:    Content-Encoding: gzip
```

---

## 10. 火山引擎 / 字节跳动 DataRangers

### 10.1 SDK 加载

Web SDK 通过 npm 包 `@datarangers/sdk-javascript` 集成：

```javascript
import SDK from '@datarangers/sdk-javascript';
SDK.init({
  app_id: 12345,
  channel: 'cn',  // 'cn' 国内, 'sg' 新加坡
  log: false
});
SDK.config({ user_unique_id: 'user123' });
```

### 10.2 上报端点

| 域名 | 用途 |
|------|------|
| `mcs.zijieapi.com` | 主数据采集（国内） |
| `applog.zijieapi.com` | 应用日志 |
| `mcs.tobsnssdk.com` | 海外数据采集 |

**URL 模式：**

```
POST https://mcs.zijieapi.com/list?aid={app_id}&device_platform=web&sdk_version=5.1.18_zip
```

### 10.3 数据格式

```json
{
  "user": {
    "user_unique_id": "user123",
    "bddid": "device_fingerprint_id",
    "web_id": "web_browser_id"
  },
  "header": {
    "app_id": 12345,
    "device_platform": "web",
    "sdk_version": "5.1.18",
    "os_name": "Windows",
    "browser": "Chrome",
    "resolution": "1920x1080",
    "language": "zh-CN"
  },
  "events": [
    {
      "event": "event_name",
      "params": "{\"key\":\"value\"}",
      "local_time_ms": 1700000000000
    }
  ]
}
```

**必需 HTTP 头：**
- `Content-Type: application/json`
- `X-MCS-AppKey: {app_key_string}`

**限制：** 每请求最多 20 个事件（超过 50 返回 413）

### 10.4 设备标识

使用 `web_id` 通过浏览器指纹（canvas、字体、屏幕属性）生成，存储在 `localStorage`。移动端使用 IDFA/IMEI/Android ID + CAID fallback。

### 10.5 批量发送

事件客户端排队，通过 `/list` 端点批量刷新。默认批大小最多 20 事件，刷新间隔约 5-15 秒。

### 10.6 识别特征

```
域名:    mcs.zijieapi.com 或 mcs.tobsnssdk.com
路径:    /list
参数:    aid=, sdk_version=, device_platform=
HTTP头:  X-MCS-AppKey
全局对象: SDK（@datarangers/sdk-javascript）
```

> **注意：** Tea Event Radar 当前的 `POST + URL 含 "list"` 拦截规则正是针对此平台设计。

---

## 11. TikTok Pixel

### 11.1 SDK 加载

```javascript
!function(w,d,t){
  w.TiktokAnalyticsObject = t;
  var ttq = w[t] = w[t] || [];
  ttq.load('{PIXEL_ID}');
  ttq.page();
}(window, document, 'ttq');
```

脚本源：`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid={PIXEL_ID}`

### 11.2 上报端点

| 端点 | 用途 |
|------|------|
| `https://analytics.tiktok.com/api/v2/pixel` | 客户端事件采集 |
| `https://business-api.tiktok.com/open_api/v1.2/pixel/track/` | 服务端 Events API（CAPI） |

### 11.3 标准事件

`PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout`, `AddPaymentInfo`, `Purchase`, `PlaceAnOrder`, `Subscribe`, `Search`, `Contact`, `Download`

### 11.4 Cookie

| Cookie | 过期 | 说明 |
|--------|------|------|
| `_ttp` | 1 年 | 第一方点击/浏览归因，关联浏览器事件与 TikTok 广告交互 |

### 11.5 识别特征

```
域名:     analytics.tiktok.com
全局对象:  window.ttq
Cookie:   _ttp
路径:     /api/v2/pixel
```

---

## 12. Heap Analytics

### 12.1 SDK 加载

```javascript
window.heap = window.heap || [];
window.heap.load("YOUR_APP_ID");
```

CDN：
- US：`https://cdn.us.heap-api.com/heap.js`
- EU：`https://cdn.eu.heap-api.com/heap.js`

### 12.2 数据采集端点

- US：`https://c.us.heap-api.com`
- EU：`https://c.eu.heap-api.com`

### 12.3 自动捕获

自动拦截 `click`、`submit`、`change`、`touchstart` 以及 `pushState`/`replaceState`/`popstate`/`hashchange`。支持事后定义 Virtual Events（回溯历史数据）。

### 12.4 Cookie

| Cookie | 过期 | 说明 |
|--------|------|------|
| `_hp2_id.{app_id}` | 13 个月 | 持久用户标识 |
| `_hp2_ses_props.{app_id}` | 30 分钟 | 会话属性 |
| `_hp2_props.{app_id}` | 13 个月 | 事件属性 |
| `_hp2_hld` | 瞬时 | 顶级域检测 |

### 12.5 识别特征

```
CDN:      cdn.us.heap-api.com 或 cdn.eu.heap-api.com
数据采集:  c.us.heap-api.com 或 c.eu.heap-api.com
全局对象:  window.heap
Cookie:   _hp2_id.*, _hp2_ses_props.*
```

---

## 13. Hotjar

### 13.1 SDK 加载

```javascript
(function(h,o,t,j,a,r){
  h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
  h._hjSettings={hjid:XXXXXXX,hjsv:6};
})(window,document,'https://static.hotjar.com/c/hotjar-'+j+'.js?sv='+s);
```

### 13.2 端点

| 端点 | 用途 |
|------|------|
| `https://static.hotjar.com/c/hotjar-{ID}.js?sv={N}` | SDK 脚本 |
| `wss://ws.hotjar.com/api/v2/client/ws` | WebSocket 会话录制 |
| `https://vc.hotjar.io` | 视频/录制数据 |
| `https://in.hotjar.com` | 事件采集 |

### 13.3 录制机制

基于 **rrweb**：
1. 会话开始时全量 DOM 快照
2. `MutationObserver` 监听后续 DOM 变化
3. 鼠标位置 100ms 采样（10Hz）
4. 数据通过 WebSocket 实时流式传输

### 13.4 Cookie

| Cookie | 过期 | 说明 |
|--------|------|------|
| `_hjSessionUser_{SITE_ID}` | 1 年 | 持久用户 ID |
| `_hjSession_{SITE_ID}` | 30 分钟 | 当前会话 |
| `_hjRecordingLastActivity` | Session（sessionStorage） | 最后录制活动时间戳 |

### 13.5 识别特征

```
脚本:    static.hotjar.com/c/hotjar-*.js
全局对象: window.hj
配置:    window._hjSettings = {hjid:X, hjsv:N}
WebSocket: ws.hotjar.com
Cookie:  _hjSessionUser_*, _hjSession_*
```

---

## 14. Microsoft Clarity

### 14.1 SDK 加载

```javascript
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
})(window, document, "clarity", "script", "PROJECT_ID");
```

### 14.2 端点

| 端点 | 用途 |
|------|------|
| `https://www.clarity.ms/tag/{PROJECT_ID}` | SDK 脚本 |
| `https://www.clarity.ms/collect` | 数据上传 |

### 14.3 数据编码

1. `clarity-js` 使用 `MutationObserver` 和事件监听器采集
2. 自定义 `encode()` 函数序列化
3. **Gzip 压缩**为二进制字节数组
4. XHR POST 发送原始压缩二进制（非 base64，非 JSON）
5. 数值使用 base-36 编码减少体积
6. 默认**遮盖所有文本**，`data-clarity-unmask` 属性选择性展示

### 14.4 Cookie

| Cookie | 类型 | 过期 | 说明 |
|--------|------|------|------|
| `_clck` | 第一方 | 1 年 | Clarity User ID |
| `_clsk` | 第一方 | 1 天 | 会话分组 |
| `CLID` | 第三方 | 永久 | 跨站首次观察标记 |
| `MUID` | 第三方 | 1 年 | Microsoft 通用浏览器 ID |

### 14.5 识别特征

```
脚本:    www.clarity.ms/tag/{ID}
上传:    www.clarity.ms/collect
全局函数: window.clarity
Cookie:  _clck, _clsk（第一方）；MUID, CLID（第三方）
开源:    github.com/microsoft/clarity
```

---

## 15. Adobe Analytics

### 15.1 实现版本

| 库 | JS 对象 | 时期 |
|----|---------|------|
| `s_code.js`（遗留） | `window.s` | 2012 年前（已废弃） |
| `AppMeasurement.js` | `window.s` | 2012–至今（广泛使用） |
| `alloy.js`（AEP Web SDK） | `window.alloy` | 2019–至今（推荐） |

### 15.2 AppMeasurement — 端点模式

```
https://{tracking_server}/b/ss/{report_suite_id}/{hit_source}/{cache_buster}?{query_string}
```

示例：`https://company.sc.omtrdc.net/b/ss/prodglobal/1/s12345678?pageName=Home&v5=LoggedIn`

| 路径组件 | 说明 |
|---------|------|
| `/b/ss/` | 固定路径前缀（所有 Analytics 图片请求标识） |
| `{report_suite_id}` | 一个或多个逗号分隔 RSID |
| `{hit_source}` | `/1/` 页面浏览、`/5/` 链接追踪、`/10/` 可穿戴 |
| `{cache_buster}` | 随机字符串防缓存 |

追踪服务器域名：`{company}.sc.omtrdc.net`（第三方）或 `metrics.{company}.com`（CNAME 第一方）

### 15.3 AppMeasurement — 核心参数

| 参数 | 说明 |
|------|------|
| `pageName` | 页面名称 |
| `g` | 页面 URL（前 255 字节） |
| `-g` | 页面 URL 溢出（256+ 字节） |
| `r` | Referrer |
| `t` | 时间戳 `dd/mm/yyyy hh:mm:ss weekday gmtoffset` |
| `aid` | Analytics 访客 ID |
| `mid` | Experience Cloud 访客 ID (ECID) |
| `v1`–`v250` | eVars（转化变量） |
| `c1`–`c75` | Props（流量变量） |
| `events` | 事件列表（如 `event1,purchase,event5`） |
| `products` | 产品字符串 |

### 15.4 AppMeasurement — Cookie

| Cookie | 域 | 过期 | 说明 |
|--------|-----|------|------|
| `s_vi` | 第一方(CNAME)/omtrdc.net | 2 年 | 主访客 ID + 时间戳 |
| `s_fid` | 第一方 | 2 年 | Fallback 访客 ID |
| `s_ecid` | 第一方 | 13 个月 | ECID 镜像 |
| `s_cc` | 第一方 | Session | Cookie 支持检测 |
| `AMCV_{org_id}` | 第一方 | 2 年 | Experience Cloud 访客 ID |
| `demdex` | `.demdex.net` | 180 天 | 跨域持久访客 ID |

### 15.5 AEP Web SDK (alloy.js) — 端点

```
POST https://edge.adobedc.net/ee/{datastreamId}/v1
```

所有数据发送到单一端点，Edge Network 路由到 Analytics、Target 等 Adobe 产品。

### 15.6 AEP Web SDK — 数据格式

使用 **XDM (Experience Data Model)** schema 的 JSON POST：

```json
{
  "xdm": {
    "eventType": "web.webpagedetails.pageViews",
    "web": {
      "webPageDetails": { "URL": "https://example.com", "name": "Page Name" }
    }
  },
  "data": {
    "__adobe": {
      "analytics": {
        "pageName": "Page Name",
        "eVar5": "CustomValue"
      }
    }
  }
}
```

### 15.7 识别特征

**AppMeasurement：**

```
路径:     /b/ss/（固定前缀）
域名:     *.sc.omtrdc.net 或 CNAME metrics.{company}.com
方式:     GET 返回 1x1 GIF
全局对象:  window.s
Cookie:   s_vi, s_fid, AMCV_*, demdex
```

**alloy.js (AEP)：**

```
路径:    edge.adobedc.net/ee/
方式:    POST JSON
全局对象: window.alloy
```

---

## 16. 汇总对比表

| 平台 | 采集端点 | 默认发送方式 | 数据编码 | Cookie | 识别关键词 |
|------|---------|------------|---------|--------|-----------|
| **神策** | `/sa?project=` | Image GET / POST / Beacon | Base64+Gzip JSON | 有 | `sa?project=`, `sensorsdata` |
| **GA4 Client** | `/g/collect` | sendBeacon/fetch POST | URL-encoded KV | 有 | `g/collect`, `tid=G-`, `v=2` |
| **GA4 MP** | `/mp/collect` | POST JSON | JSON | 无 | `mp/collect`, `api_secret` |
| **百度统计** | `/hm.gif` | Image GET | URL query params | 有 | `hm.baidu.com`, `si=` |
| **GrowingIO** | `/v3/.../collect` | POST JSON/Protobuf | JSON/Protobuf+Gzip | 有 | `growingio.com`, `eventType` |
| **Mixpanel** | `/track/` | POST XHR / Beacon | JSON | 有 | `mixpanel.com`, `$token` |
| **Segment** | `/v1/t`, `/v1/batch` | POST JSON | JSON | 有 | `api.segment.io`, `anonymousId` |
| **Amplitude** | `/2/httpapi` | POST JSON | JSON | 可选 | `amplitude.com`, `api_key` |
| **Matomo** | `matomo.php` | GET / POST JSON batch | URL query / JSON | 有 | `matomo.php`, `idsite=`, `rec=1` |
| **Plausible** | `/api/event` | POST JSON | JSON | 无 | `/api/event`, `data-domain` |
| **Umami** | `/api/send` | POST JSON | JSON | 无 | `/api/send`, `data-website-id` |
| **PostHog** | `/i/v0/e`, `/batch/` | POST JSON | JSON+gzip-js | 可选 | `phc_`, `/i/v0/e`, `/batch/` |
| **DataRangers** | `/list?aid=` | POST JSON | JSON | 可选 | `zijieapi.com`, `/list`, `X-MCS-AppKey` |
| **TikTok Pixel** | `/api/v2/pixel` | POST XHR | JSON | 有 | `analytics.tiktok.com`, `_ttp` |
| **Heap** | `c.*.heap-api.com` | POST JSON | JSON | 有 | `heap-api.com`, `_hp2_id.*` |
| **Hotjar** | `ws.hotjar.com` (WS) | WebSocket | Binary (rrweb) | 有 | `hotjar.com`, `_hjSession*` |
| **Clarity** | `clarity.ms/collect` | POST XHR | Gzip binary | 有 | `clarity.ms`, `_clck`, `_clsk` |
| **Adobe (AM)** | `/b/ss/{rsid}/` | GET Image | URL query | 有 | `/b/ss/`, `omtrdc.net`, `s_vi` |
| **Adobe (AEP)** | `edge.adobedc.net/ee/` | POST JSON | JSON (XDM) | 有 | `adobedc.net`, `alloy` |

---

## 17. 请求拦截识别建议

在网关或浏览器扩展层面识别埋点请求，建议按以下维度组合匹配：

### 17.1 域名匹配规则

```
# 商业平台
google-analytics.com          → GA4
hm.baidu.com                 → 百度统计
api-js.mixpanel.com           → Mixpanel
api.mixpanel.com              → Mixpanel
api.segment.io                → Segment
cdn.segment.com               → Segment
api2.amplitude.com            → Amplitude
api.amplitude.com             → Amplitude
*.growingio.com               → GrowingIO
napi.growingio.com            → GrowingIO
mcs.zijieapi.com              → DataRangers/字节
mcs.tobsnssdk.com             → DataRangers/字节
analytics.tiktok.com          → TikTok Pixel
*.heap-api.com                → Heap
static.hotjar.com             → Hotjar
ws.hotjar.com                 → Hotjar
www.clarity.ms                → Microsoft Clarity
*.sc.omtrdc.net               → Adobe Analytics
edge.adobedc.net              → Adobe AEP
*.posthog.com                 → PostHog

# 开源（自托管需按实际域名配置）
plausible.io                  → Plausible
```

### 17.2 路径匹配规则

```
/sa?                          → 神策
/g/collect                    → GA4
/mp/collect                   → GA4 Measurement Protocol
/collect (+ v=1)              → Universal Analytics
/hm.gif                       → 百度统计
/track/                       → Mixpanel
/engage/                      → Mixpanel
/v1/t, /v1/p, /v1/i, /v1/batch → Segment
/2/httpapi, /batch            → Amplitude
/v3/projects/*/collect        → GrowingIO
/list?aid=                    → DataRangers/字节
/api/v2/pixel                 → TikTok Pixel
/b/ss/                        → Adobe Analytics
/ee/                          → Adobe AEP
matomo.php, piwik.php         → Matomo
/api/event                    → Plausible
/api/send                     → Umami
/i/v0/e, /capture, /batch/    → PostHog
/collect (clarity.ms)         → Clarity
```

### 17.3 参数/负载特征

| 特征 | 平台 |
|------|------|
| `tid=G-` | GA4 |
| `v=2` (GA4) / `v=1` (UA) | Google Analytics |
| `si=`（32 位 hex） | 百度统计 |
| `idsite=` + `rec=1` | Matomo |
| `api_key=` + `events[]` | Amplitude |
| `$token` / `token` in properties | Mixpanel |
| `anonymousId` + `writeKey` | Segment |
| `api_key` 以 `phc_` 开头 | PostHog |
| `X-MCS-AppKey` header | DataRangers |
| `data-domain` attr | Plausible |
| `data-website-id` attr | Umami |

### 17.4 Content-Type 分布

| Content-Type | 常见平台 |
|-------------|---------|
| `image/gif` GET | 百度统计、神策(image)、Adobe(AM) |
| `application/json` POST | Mixpanel、Segment、Amplitude、GrowingIO、PostHog、Plausible、Umami、TikTok |
| `text/plain` POST | 神策(ajax/beacon)、GA4(beacon) |
| `application/x-protobuf` POST | GrowingIO(可选) |
| `application/octet-stream` POST | Mixpanel Session Replay |
| WebSocket binary | Hotjar |
| Gzip binary POST | Clarity |

---

## 附录 A：各平台 Cookie 速查表

| 平台 | 主要 Cookie | 域 | 过期 |
|------|-----------|-----|------|
| 神策 | `sensorsdata2015jssdkcross` | 第一方（根域） | 360 天 |
| GA4 | `_ga`, `_ga_XXXXX` | 第一方 | 2 年 |
| 百度统计 | `HMACCOUNT`, `Hm_lvt_*`, `Hm_lpvt_*` | 第三方+第一方 | 永久/1年/Session |
| GrowingIO | `grwng_uid`, `grwng_sid` | 第一方 | 1年/Session |
| Mixpanel | `mp_<TOKEN>_mixpanel` | 第一方 | 365 天 |
| Segment | `ajs_anonymous_id`, `ajs_user_id` | 第一方 | 1 年 |
| Amplitude | `AMP_<KEY前10字符>` | 第一方 | — |
| Matomo | `_pk_id.*`, `_pk_ses.*`, `_pk_ref.*` | 第一方 | 13月/30分/6月 |
| Plausible | 无 | — | — |
| Umami | 无 | — | — |
| PostHog | 可选 | 第一方 | — |
| TikTok Pixel | `_ttp` | 第一方 | 1 年 |
| Heap | `_hp2_id.*`, `_hp2_ses_props.*` | 第一方 | 13月/30分 |
| Hotjar | `_hjSessionUser_*`, `_hjSession_*` | 第一方 | 1年/30分 |
| Clarity | `_clck`, `_clsk` | 第一方 | 1年/1天 |
| Adobe | `s_vi`, `AMCV_*`, `demdex` | 第一方+第三方 | 2年/2年/180天 |

---

## 附录 B：Tea Event Radar 拦截规则扩展建议

当前 Tea Event Radar 仅拦截 `POST + URL 含 "list"` 的请求（匹配 DataRangers/字节系 SDK）。若需支持多平台，可按以下优先级扩展：

| 优先级 | 匹配规则 | 覆盖平台 |
|--------|---------|---------|
| P0（当前） | POST + URL 含 `list` | DataRangers |
| P1 | 域名 `hm.baidu.com` + 路径 `/hm.gif` | 百度统计 |
| P1 | 域名含 `google-analytics.com` + 路径 `/g/collect` | GA4 |
| P1 | 路径含 `/sa?` | 神策 |
| P2 | 域名含 `mixpanel.com` + 路径 `/track/` | Mixpanel |
| P2 | 域名 `api.segment.io` + 路径 `/v1/` | Segment |
| P2 | 域名含 `amplitude.com` + 路径 `/2/httpapi` | Amplitude |
| P2 | 域名含 `growingio.com` + 路径 `/v3/` | GrowingIO |
| P3 | 路径含 `matomo.php` 或 `piwik.php` | Matomo |
| P3 | 路径 `/api/event` | Plausible |
| P3 | 路径 `/api/send` | Umami |
| P3 | 路径含 `/i/v0/e` 或 `/capture` 或 `/batch/` | PostHog |
| P3 | 路径含 `/b/ss/` | Adobe Analytics |
| P4 | 域名 `analytics.tiktok.com` | TikTok Pixel |
| P4 | 域名含 `heap-api.com` | Heap |
| P4 | 域名 `www.clarity.ms` + 路径 `/collect` | Clarity |

> 建议设计为可配置规则引擎，允许用户自定义匹配模式。

---

## 附录 C：版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-03-20 | 初始版本，覆盖 16 个埋点平台的上报特征 |
