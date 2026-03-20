# 主流埋点平台上报请求特征技术参考

> Status: Reference
> Source of truth: 公开文档 + 网络调研 + 实际抓包验证
> Last synced: 2026-03-20
> Freshness: 🟢 FRESH
> Scope: `神策` + `GA4` + `百度统计` + `GrowingIO` + `Mixpanel` + `Segment` + `Amplitude` + `Matomo` + `Plausible` + `Umami` + `PostHog` + `ByteDance DataRangers` + `TikTok Pixel` + `Heap` + `Hotjar` + `Microsoft Clarity` + `Adobe Analytics`

---

## 1. 文档目的

本文档汇总主流埋点/分析平台的上报请求特征，作为 Tea Event Radar 扩展拦截规则设计和平台识别的技术参考。

文档涵盖：

- 各平台 SDK 加载方式、上报端点、发送方式、数据格式
- Cookie / 本地存储详情
- 批量发送与队列机制
- 数据编码与压缩方式
- 反广告拦截能力
- 请求拦截识别特征

---

## 2. 神策 Sensors Data

### 2.1 SDK 加载方式

页面嵌入异步加载 `sensorsdata.min.js`，通过 `sensors.init()` 初始化，配置 `server_url` 指向数据接收服务。

### 2.2 上报端点

| 部署方式 | 端点格式 | 说明 |
|---------|---------|------|
| 私有部署 (≥1.7) | `https://{host}:8106/sa?project={project_name}` | 默认端口 8106 |
| 私有部署 (≤1.7) | `https://{host}:8006/sa?project={project_name}` | 旧版端口 8006 |
| Cloud 服务 | `https://{name}.cloud.sensorsdata.cn:8006/sa?token={token}` | Cloud SaaS |
| Cloud 服务 (新) | `https://{name}.datasink.sensorsdata.cn/sa?token={token}` | 新域名，HTTPS 443/4006 |

### 2.3 发送方式（send_type 配置）

| send_type | 方式 | 版本要求 | Content-Type |
|-----------|------|---------|-------------|
| `image`（默认） | 1×1 GIF 像素 GET 请求 | 全版本 | 浏览器自动处理（image/gif） |
| `ajax` | XMLHttpRequest POST | v1.10+ | `text/plain` 或 `application/x-www-form-urlencoded`（避免 CORS preflight） |
| `beacon` | `navigator.sendBeacon()` POST | v1.15.26+ | `text/plain`（浏览器自动设置） |

### 2.4 数据格式与编码

**标准编码管线：**

```
JSON 负载 → Gzip 压缩 → Base64 编码 → URL Encode
→ POST body: data_list=<encoded>&gzip=1
   或单条: data=<encoded>&gzip=1
```

**type 字段区分事件类型：**

| type 值 | 含义 |
|---------|------|
| `track` | 事件追踪 |
| `track_signup` | 注册关联 |
| `profile_set` | 用户属性设置 |
| `profile_set_once` | 首次设置用户属性 |
| `profile_increment` | 数值属性累加 |
| `profile_append` | 列表属性追加 |
| `profile_unset` | 删除用户属性 |
| `profile_delete` | 删除用户 |

**加密选项（可选）：**

| 加密方式 | SDK 版本 | 说明 |
|---------|---------|------|
| AES 对称加密 | v1.19.9+ | 需要 SDF 后端 ≥2.3 |
| SM4 国密加密 | v1.25.20+ | 中国金融/政务合规场景 |
| Cookie 加密 | v1.16.10+ | `encrypt_cookie: true` 加密 Cookie 值 |
| localStorage 加密 | v1.21.9+ | 加密本地存储队列数据 |

### 2.5 Cookie 详情

**主 Cookie：** `sensorsdata2015jssdkcross`

- **格式：** URL-encoded JSON 字符串
- **域：** 默认设置在根域（`cross_subdomain: true`）
- **过期：** 360 天（v1.26.12 起，此前为 730 天）
- **SameSite：** v1.18.10+ 支持配置

**Cookie JSON 字段：**

```json
{
  "distinct_id": "当前活跃 ID（匿名或登录）",
  "first_id": "原始匿名 ID（login() 后填充）",
  "login_id": "登录用户 ID",
  "anonymous_id": "设备/浏览器生成的 UUID"
}
```

**跨域用户关联：** SiteLinker 插件通过 URL 参数 `_sasdk=<distinctID>` 传递身份信息。

### 2.6 批量发送与队列机制

**Web SDK（batch_send 模式）：**

```javascript
batch_send: {
  datasend_timeout: 6000,  // 请求超时（ms）
  send_interval: 6000,     // 轮询发送间隔（ms）
  storage_length: 200      // localStorage 队列最大记录数
}
```

- 默认关闭（`batch_send: false`），每次 `track()` 立即发送
- 启用后使用 `localStorage` 作为写前日志缓冲
- 队列超过 200 条时，删除最老的 100 条，新事件回退为即时 `image` 发送
- `$pageview` 和 `$SignUp` 事件始终立即触发刷新
- v1.27.11 引入 IndexedDB 插件替代 localStorage，提供更大存储容量

**移动端 SDK：**

| 配置项 | Android 默认值 | iOS 默认值 |
|-------|---------------|-----------|
| `flushInterval` | 15 秒 | 15 秒 |
| `flushBulkSize` | 100 条 | 100 条 |
| 本地缓存上限 | 32 MB（SQLite） | 10,000 条（SQLite） |
| 网络策略 | WiFi/3G/4G/5G（默认排除 2G） | WiFi/3G/4G/5G |

### 2.7 反广告拦截

- **自定义代理域名**：`server_url` 指向自有域名的反向代理（如 `https://analytics.yourdomain.com/collect`）
- **`custom_server_url`（v1.27.8+）**：SDK 内置自定义代理域名配置
- **SDK 自托管**：将 JS 文件部署到自有 CDN，避免 URL 中出现 `sensorsdata.cn`

### 2.8 SDK 版本关键变更

| SDK 版本 | 变更 |
|---------|------|
| v1.10+ | 新增 `ajax` 和 `beacon` 发送方式 |
| v1.16.10 | Cookie 加密 |
| v1.18.10 | SameSite Cookie 属性支持 |
| v1.19.9 | AES 数据传输加密插件 |
| v1.24.1 | 插件架构重构 |
| v1.25.20 | SM4 国密加密 |
| v1.26.9 | 移除 Cookie 中的 `device_id` 字段 |
| v1.26.12 | Cookie 过期从 730 天缩短为 360 天 |
| v1.27.1 | v2 包移除内嵌插件（体积减少 ~25%） |
| v1.27.8 | `custom_server_url` 参数 |
| v1.27.11 | IndexedDB 插件 |

### 2.9 识别特征

| 维度 | 特征 |
|------|------|
| URL 路径 | `/sa?project=` 或 `/sa?token=` |
| JS 文件名 | 包含 `sensorsdata` |
| 全局变量 | `sensorsDataAnalytic201505` |
| Cookie | `sensorsdata2015jssdkcross` |
| POST body | `data_list=` 或 `data=` 参数 + `gzip=` 标记 |

---

## 3. Google Analytics（GA4 + 遗留版本）

### 3.1 GA4 客户端采集（gtag.js）

**SDK 加载方式：** 通过 `gtag.js` 代码片段加载，自动采集 `page_view` 等事件。

**上报端点：**

| 端点 | 用途 |
|------|------|
| `https://www.google-analytics.com/g/collect` | GA4 自动采集（主端点） |
| `https://region1.google-analytics.com/g/collect` | EU 区域 |
| `https://www.google-analytics.com/r/collect` | 启用广告功能时 |
| `https://www.google-analytics.com/debug/mp/collect` | 验证端点 |

**发送方式：**

- 默认使用 GET 请求，参数编码在 URL query string 中
- 支持 `navigator.sendBeacon()` POST（通过 `transport: 'beacon'` 配置）
- 支持 `fetch()` with `keepalive: true`（gtag.js 近期更新优先使用）
- 参数以扁平化 key=value 编码，非 JSON 格式

**核心请求参数：**

| 参数 | 名称 | 说明 |
|------|------|------|
| `v` | 协议版本 | GA4 固定为 `2` |
| `tid` | Measurement ID | 格式 `G-XXXXXXXXXX` |
| `cid` | Client ID | 来自 `_ga` Cookie 的唯一浏览器标识 |
| `uid` | User ID | 认证用户标识 |
| `_p` | 页面随机种子 | 每次页面加载生成，用于去重 |
| `sid` | Session ID | 会话开始的 Unix 时间戳 |
| `sct` | Session count | 该用户的总会话数 |
| `seg` | Session engaged | `1`=活跃会话（10s+/2+页面/转化） |
| `_ss` | Session start | 新会话首次命中标记 |
| `_fv` | First visit | 首次访问标记 |
| `en` | Event name | 事件名（如 `page_view`、`click`） |
| `ep.*` | 事件参数（字符串） | 自定义字符串维度 |
| `epn.*` | 事件参数（数值） | 自定义数值指标 |
| `up.*` | 用户属性（字符串） | 用户维度 |
| `upn.*` | 用户属性（数值） | 用户数值属性 |
| `_et` | Engagement time | 活跃参与毫秒数 |
| `dl` | Document location | 页面完整 URL |
| `dr` | Document referrer | 来源 URL |
| `dt` | Document title | 页面标题 |
| `ul` | User language | 浏览器语言 |
| `sr` | Screen resolution | 屏幕分辨率 |
| `_dbg` | Debug mode | GA Debugger 或 GTM Preview 激活时为 `1` |

**User-Agent Client Hints 参数（替代 UA 字符串）：**

| 参数 | 说明 |
|------|------|
| `uaa` | 架构（如 `x86`） |
| `uab` | 位数（如 `64`） |
| `uafvl` | 完整版本列表 |
| `uamb` | 移动标记 |
| `uap` | 平台（如 `Windows`） |
| `uapv` | 平台版本 |

**Consent Mode 参数：**

| 参数 | 格式 | 说明 |
|------|------|------|
| `gcs` | `G1<x><y>` | v1 同意状态。x=ad_storage, y=analytics_storage, 0=拒绝, 1=同意 |
| `gcd` | `11<ad>1<analytics>1<user_data>1<personalization>5` | v2 同意状态，字母编码历史 |

### 3.2 GA4 Cookie 详情

**`_ga` Cookie：**

- **格式：** `GA1.<domain_level>.<random10digit>.<unix_timestamp>`
- **示例：** `GA1.1.1197596843.1673515099`
- **过期：** 2 年（Safari ITP 下被限制为 ~7 天）
- **用途：** Client ID，随每次命中作为 `cid` 发送

**`_ga_<STREAM_ID>` Cookie — GS2 格式（2025 年 5 月起）：**

- **格式：** `GS2.1.s<session_id>$o<session_number>$g<engaged_flag>$t<last_hit_timestamp>$j<join_timer>$l<logged_in_state>$h<enhanced_user_id_hash>`
- 旧 GS1 格式为固定位置：`GS1.1.<session_id>.<session_count>.<engagement>.<last_timestamp>.<something>`

| 键 | 含义 |
|----|------|
| `s` | Session ID（会话开始 Unix 时间戳） |
| `o` | Session count |
| `g` | 活跃标记（0/1） |
| `t` | 最后交互时间戳 |
| `j` | Join timer（60 秒 Google Signals 同步倒计时） |
| `l` | 增强用户登录状态 |
| `h` | 增强用户 ID 哈希 |

**其他 Cookie：**

| Cookie | 过期 | 说明 |
|--------|------|------|
| `_gid` | 24 小时 | 短期会话标识（遗留） |
| `FPID` | 2 年 | 服务端 GTM 管理的第一方标识（HttpOnly） |
| `FPLC` | 20 小时 | FPID 哈希（JS 可读，跨域追踪用） |

### 3.3 跨域追踪：`_gl` Linker 结构

```
_gl=1*<fingerprint>*_ga*<encoded_ga_value>*_ga_XXXXXXXX*<encoded_session_value>
```

- `fingerprint`：CRC32 浏览器指纹（base-36），基于 `User-Agent + 时区偏移 + 语言 + 时间窗口`
- `_ga*<value>`：Base64 编码的 `_ga` Cookie 值
- **有效期：** ~2 分钟（2 个 60 秒时间窗口）

### 3.4 服务端 GTM

```
浏览器 → gtag.js → 服务端 GTM（自有子域名）→ GA4 Client 解析 → google-analytics.com
```

- 服务端容器设置 `FPID` Cookie（HttpOnly，绕过 ITP 限制，可持久 2 年）
- 所有流量表现为第一方请求

### 3.5 离线与重试

- gtag.js **没有**内置离线队列或重试机制
- 网络不可用时事件被**静默丢弃**
- `workbox-google-analytics` 模块仅兼容 UA，不兼容 GA4
- GA4 离线恢复需自行实现 Service Worker 或使用 Measurement Protocol + `timestamp_micros` 回填

### 3.6 GA4 Measurement Protocol（服务端）

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

**限制：** 每请求最多 25 个事件，POST body ≤130KB，参数名 ≤40 字符，参数值 ≤100 字符。

### 3.7 Universal Analytics（已停用，遗留兼容）

| 端点 | 方式 |
|------|------|
| `https://www.google-analytics.com/collect` | 单条，GET/POST |
| `https://www.google-analytics.com/batch` | 批量 |

参数格式：`v=1&t=pageview&tid=UA-XXXXX-X&cid=xxx`

### 3.8 识别特征

| 版本 | 特征 |
|------|------|
| GA4 Client | `/g/collect`，`v=2`，`tid=G-`，域名 `google-analytics.com` |
| GA4 MP | `/mp/collect`，`api_secret` 参数 |
| UA (遗留) | `/collect` + `v=1` + `tid=UA-` |

---

## 4. 百度统计

### 4.1 SDK 加载方式

页面嵌入代码动态创建 `<script>` 加载 `https://hm.baidu.com/hm.js?{统计ID}`。

### 4.2 上报端点

```
https://hm.baidu.com/hm.gif?{params}
```

以 GET 请求加载 1×1 透明 GIF 图片（Image Beacon），所有数据作为 URL query 参数。

### 4.3 请求触发时序

每次页面访问触发 4 次请求：

1. 加载 `hm.js?{统计ID}` 获取 JS 脚本
2. 首次 `hm.gif` 请求（页面进入，`ep=0`）
3. 第二次 `hm.gif` 请求（携带更多上下文）
4. 页面退出时 `hm.gif` 请求（`ep` 记录停留时长，如 `ep=7289,115`）

### 4.4 完整参数列表

| 参数 | 含义 | 示例 |
|------|------|------|
| `si` | 统计代码 ID（32 位十六进制） | `abc123def456...` |
| `su` | 上一页 referrer | URL 编码字符串 |
| `ds` | 屏幕尺寸 | `1440x900` |
| `cl` | 颜色深度 | `32-bit` |
| `ln` | 语言 | `zh-cn` |
| `ep` | 页面停留时间 | `7289,115`（毫秒） |
| `et` | 事件类型标记 | `0`（初始），退出时变化 |
| `lt` | Unix 时间戳（秒） | `1710835200` |
| `rnd` | 随机数（防缓存） | 10 位随机数 |
| `v` | SDK 版本号 | `1.2.30` |
| `ck` | 是否支持 Cookie | `1`/`0` |
| `cc` | Cookie 计数 | `1` |
| `fl` | Flash 版本 | `11.0` |
| `ja` | Java 支持 | `1`/`0` |
| `nv` | 导航类型 | `1`/`0` |
| `sb` | 特殊浏览器标识 | `17`（360 浏览器） |
| `se` | 搜索引擎编码标识 | 编码字符串 |
| `sw` | 搜索关键词 | 编码字符串 |
| `cf` | 推广来源 | URL 参数 `hmsr` 的值 |
| `ci` | 推广 ID | URL 参数 `hmci` 的值 |
| `cm` | 推广媒介 | URL 参数 `hmmd` 的值 |
| `cp` | 推广位置 | URL 参数 `hmpl` 的值 |
| `cw` | 推广关键词 | URL 参数 `hmkw` 的值 |
| `lo` | 登出标记 | `0` |
| `st` | 来源页数据 | 编码字符串 |

### 4.5 Cookie 详情

| Cookie | 域 | 类型 | 过期 | 用途 |
|--------|---|------|------|------|
| `HMACCOUNT` | `.hm.baidu.com` | **第三方** | 2038 年（永久） | 跨站用户标识 |
| `HMACCOUNT_BFESS` | `.hm.baidu.com` | 第三方 | 永久 | 百度搜索环境变体 |
| `Hm_lvt_<siteid>` | 站点域名 | 第一方 | 1 年 | 最近 4 次访问时间戳（逗号分隔 Unix 时间戳） |
| `Hm_lpvt_<siteid>` | 站点域名 | 第一方 | 会话 | 当前页面浏览时间戳 |

**存储冗余：** 百度统计将 `Hm_lvt` 和 `Hm_lpvt` 值同时写入 `localStorage` 和 `sessionStorage`，在 Cookie 被清除时仍可恢复。

**会话定义：** 关闭浏览器重新打开、不活跃超过 30 分钟、或来自不同来源均触发新会话。

### 4.6 事件追踪 API

```javascript
_hmt.push(['_trackEvent', category, action, opt_label, opt_value]);
```

事件参数编码到 `hm.gif` 请求的查询参数中，`et` 参数区分事件命中和页面浏览命中。

**自定义变量：**

```javascript
_hmt.push(['_setCustomVar', index, name, value, opt_scope]);
// index: 1-5, scope: 1=访客级, 2=访问级, 3=页面级(默认)
```

### 4.7 SPA 支持

| 方式 | 说明 |
|------|------|
| 手动 `_trackPageview` | 路由变化时调用 `_hmt.push(['_trackPageview', path])` |
| UrlChangeTracker 插件 | `_hmt.push(['_requirePlugin', 'UrlChangeTracker', {...}])`，自动检测 `hashchange` 和 `pushState` |
| 后台设置 | 启用"单页应用数据统计"开关 |

### 4.8 跨域追踪

百度统计**没有**内置跨域 linker 机制。跨站用户识别完全依赖第三方 `HMACCOUNT` Cookie。随着第三方 Cookie 逐步被淘汰，该机制面临失效风险。

### 4.9 反广告拦截

百度统计**不提供**官方自定义域名/第一方代理功能。`hm.baidu.com/hm.js` 和 `hm.baidu.com/hm.gif` 均在主流广告拦截列表中。

### 4.10 识别特征

| 维度 | 特征 |
|------|------|
| 域名 | `hm.baidu.com` |
| 路径 | `/hm.gif` 或 `/hm.js` |
| 参数 | `si=`（32 位十六进制统计 ID） |
| Cookie | `Hm_lvt_*`、`Hm_lpvt_*`、`HMACCOUNT` |

---

## 5. GrowingIO

### 5.1 SDK 加载方式

Web 端集成 JS SDK（无埋点 + 代码埋点），自动采集页面浏览、点击等行为事件。

- **SDK 4.x（当前）：** npm 包 `gio-web-autotracker`，全局对象 `window.gdp`
- **SDK 3.x：** 全局对象 `window.gio`
- **SDK 2.x（遗留）：** CDN `assets.giocdn.com/2.1/gio.js`，全局对象 `window.gio`

### 5.2 无埋点（Autotrack）机制

**DOM 事件监听（事件委托）：**

- `click` — 所有点击事件
- `change` — 输入/选择元素变化
- `submit` — 表单提交
- `touchstart` / `touchend` — 移动端触摸
- `hashchange` / `popstate` — SPA URL 变化
- `pushState` / `replaceState` 拦截 — 通过原型覆盖实现

**XPath 元素标识：** 使用精确路径（如 `body>div[0]>div[3]>ul>li[5]>a[0]`）和近似路径定位交互元素。

**自定义 DOM 属性：**

| 属性 | 作用 |
|------|------|
| `data-growing-container` | 命名容器边界 |
| `data-growing-title` | 覆盖元素文本标签 |
| `data-growing-idx` | 列表位置索引 |
| `data-growing-ignore="true"` | 排除元素及子元素 |
| `data-growing-track="true"` | 启用输入字段文本捕获 |

### 5.3 上报端点

| 模式 | 端点 | 路径 |
|------|------|------|
| NewSaaS（SDK 3.x/4.x） | `https://napi.growingio.com` | `/v3/projects/{accountId}/collect` |
| SaaS（2.x 遗留） | `https://api.growingio.com` | `/v2/{projectId}/events` 或 `/s.gif` |
| CDP / 私有部署 | 自定义 `dataCollectionServerHost` | `/v3/projects/{accountId}/collect` |

### 5.4 事件类型与负载结构

**SDK 3.x/4.x 事件类型：**

| 类型 | 说明 |
|------|------|
| `VISIT` | 新会话开始 |
| `PAGE` | 页面浏览 |
| `VIEW_CLICK` | 自动采集点击 |
| `VIEW_CHANGE` | 输入/选择变化 |
| `FORM_SUBMIT` | 表单提交 |
| `CUSTOM` | 开发者通过 `gdp('track', name, props)` 触发 |
| `LOGIN_USER_ATTRIBUTES` | 登录用户属性 |

**基础字段（所有事件类型共享）：**

```json
{
  "eventType": "VIEW_CLICK",
  "timestamp": 1700000000000,
  "domain": "www.example.com",
  "path": "/product/123",
  "query": "?ref=nav",
  "title": "Product Page",
  "referralPage": "https://example.com/home",
  "sessionId": "abc123sessionid",
  "userId": "anonymous_device_id",
  "deviceId": "persistent_device_id",
  "platform": "Web",
  "sdkVersion": "4.3.1",
  "dataSourceId": "ds_id",
  "attributes": {}
}
```

### 5.5 数据编码与压缩

| SDK 版本 | 编码方式 |
|---------|---------|
| 2.x | gzip + JSON |
| 3.x/4.x（默认） | gzip + JSON，`Content-Type: application/json` |
| 3.x/4.x（可选） | Protobuf 二进制（`useProtobuf: true`），`Content-Type: application/x-protobuf` |
| 3.x/4.x（可选） | Snappy 压缩 + Protobuf（`compressEnabled: true`） |
| 3.x/4.x（可选） | XOR/AES-128 加密（`encryptEnabled: true`） |

### 5.6 Cookie 与本地存储

| Cookie | 过期 | 用途 |
|--------|------|------|
| `grwng_uid` | 1 年 | 持久设备/用户标识 |
| `grwng_sid` | 会话 | 会话标识（30 分钟不活跃后重新生成） |
| `gr_user_id` | 1 年 | 登录用户 ID（`setUserId()` 后设置） |

SDK 3.x+ 同时使用 `localStorage` 持久化 `deviceId`、`userId` 和事件队列。

### 5.7 批量发送

- 事件写入 `localStorage` 队列
- 定时器每 10–15 秒刷新（可配置）或达到队列大小阈值时发送
- 页面卸载时使用 `navigator.sendBeacon()` 刷新剩余事件
- 失败请求重新入队，下次刷新周期重试

### 5.8 Hybrid H5-Native 桥接

1. 原生 SDK 向 WebView 注入 `window.GrowingWebViewBridge` JS 桥接对象
2. H5 SDK 调用 `gio('getGioInfo')` 获取原生会话的 `sessionId`、`deviceId`、`userId`
3. 返回查询字符串 `?growing_imei=xxx&growing_id=yyy&growing_sid=zzz`
4. 确保嵌入式 H5 页面事件归属到同一用户会话

### 5.9 反广告拦截

```javascript
// SDK 3.x/4.x
gdp('init', accountId, dataSourceId, appId, {
  dataCollectionServerHost: 'https://analytics.yourcompany.com'
});
```

GrowingIO 提供 **Growing HUB** 代理服务，部署在客户自有服务器上，通过 Nginx 反向代理完全隐藏目标域名。

### 5.10 识别特征

| 维度 | 特征 |
|------|------|
| 域名 | `growingio.com`、`napi.growingio.com` 或自定义域名 |
| 路径 | `/v3/projects/*/collect`、`/v2/` |
| 全局变量 | `window.gdp`（4.x）、`window.gio`（2.x/3.x） |
| Cookie | `grwng_uid`、`grwng_sid` |
| 负载 | 含 `eventType`、`dataSourceId` 字段 |

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
| EU 区域 | `https://api-eu.mixpanel.com/` |

### 6.3 发送方式与批量机制

| 配置项 | 默认值 | 说明 |
|-------|--------|------|
| `batch_requests` | `true` | 启用批量 |
| `batch_size` | 50 | 每批最大事件数 |
| `batch_flush_interval_ms` | 5000 (5 秒) | 刷新间隔 |
| `batch_request_timeout_ms` | 90000 (90 秒) | 请求超时 |

先到达 `batch_size` 或 `batch_flush_interval_ms` 的触发发送。页面卸载时也自动刷新。

**移动端 SDK：** 默认 60 秒刷新间隔，`flushOnBackground: true`。

### 6.4 数据格式

**`/track`（事件）：**

```json
{
  "event": "Page View",
  "properties": {
    "token": "YOUR_TOKEN",
    "distinct_id": "user123",
    "time": 1234567890,
    "$device_id": "device_uuid",
    "$user_id": "user123",
    "custom_property": "value"
  }
}
```

- `token` 在 `properties` 内部
- 时间戳必须在当前时间 **5 天内**（历史数据使用 `/import`）

**`/engage`（用户属性）：**

```json
{
  "$token": "YOUR_TOKEN",
  "$distinct_id": "user123",
  "$set": { "email": "user@example.com", "plan": "pro" }
}
```

- `$token` 在顶层
- 操作类型：`$set`、`$set_once`、`$add`、`$append`、`$remove`、`$unset`、`$delete`

**`/groups`（分组属性）：**

```json
{
  "$token": "YOUR_TOKEN",
  "$group_key": "company",
  "$group_id": "acme-corp",
  "$set": { "industry": "SaaS" }
}
```

### 6.5 Session Replay

- 基于 **rrweb** 开源 DOM 录制库
- 数据每 **10 秒**刷新一次
- 使用浏览器 `CompressionStream` API（gzip/deflate）压缩后发送
- Content-Type：`application/octet-stream`
- 端点：`api-js.mixpanel.com/record/`
- 默认所有文本和输入均被遮罩

### 6.6 Cookie / localStorage

**Cookie 名称格式：** `mp_<TOKEN>_mixpanel`

**内容（URI 编码 JSON）：**

- `distinct_id` — 当前用户标识
- `$device_id` — 设备级随机 ID（跨登录持久）
- `$user_id` — `identify()` 后设置
- Super properties（`register()` 设置的自定义属性）
- `$initial_referrer` / `$initial_referring_domain`
- UTM 参数

**持久化选项：** `cookie`（默认，365 天）或 `localStorage`。

### 6.7 自定义代理

```javascript
mixpanel.init("TOKEN", {
  api_host: "https://your-proxy-domain.com"
});
```

Mixpanel 提供官方 [tracking-proxy](https://github.com/mixpanel/tracking-proxy) nginx 配置。

### 6.8 速率限制

| API | 限制 |
|-----|------|
| 摄入 API | 2 GB/分钟（~30k events/s） |
| 单请求 | 最多 2000 事件，≤10 MB |
| 查询 API | 5 并发，60 次/小时 |

### 6.9 身份管理

**简化 ID 合并（当前默认）：** 每个事件同时携带 `$device_id` 和 `$user_id`，服务端自动关联，无需 `$identify` 或 `$create_alias` 事件。

**经典 ID 合并（遗留）：** `.identify()` 发送 `$identify` 事件，`.alias()` 发送 `$create_alias` 事件。

### 6.10 识别特征

| 维度 | 特征 |
|------|------|
| 域名 | `api-js.mixpanel.com` 或 `api.mixpanel.com` |
| 路径 | `/track/`、`/engage/`、`/groups/`、`/record/` |
| Cookie | `mp_<TOKEN>_mixpanel` |
| 负载 | 含 `token`、`distinct_id`、`$browser` 等 Mixpanel 专有属性 |

---

## 7. Segment

### 7.1 SDK 加载方式

通过 Analytics.js snippet 异步加载，从 `cdn.segment.com` 拉取配置和库文件。

**加载流程：**

1. `<head>` 中的 snippet 创建 `window.analytics` 存根，缓冲调用
2. 请求 `https://cdn.segment.com/v1/projects/<WRITE_KEY>/settings` 获取启用的目标配置
3. 加载 Analytics.js 核心库
4. Device-mode 目标：延迟加载各第三方 SDK（如 Mixpanel SDK、Amplitude SDK）
5. Cloud-mode 目标：事件发送到 Segment 服务器，由 Segment 转发

### 7.2 上报端点

| 端点 | 用途 |
|------|------|
| `POST https://api.segment.io/v1/t` | track |
| `POST https://api.segment.io/v1/p` | page |
| `POST https://api.segment.io/v1/i` | identify |
| `POST https://api.segment.io/v1/batch` | 批量发送 |
| EU 区域 | `POST https://events.eu1.segmentapis.com/v1/...` |

### 7.3 发送方式

- POST 请求，`Content-Type: application/json`
- `writeKey` 用于 Basic Auth（用户名为 writeKey，密码为空）
- 支持 `sendBeacon` 模式（页面卸载时自动启用）

### 7.4 批量配置

```javascript
analytics.load("WRITE_KEY", {
  integrations: {
    "Segment.io": {
      deliveryStrategy: {
        strategy: "batching",
        config: {
          size: 10,      // 10 个事件触发刷新
          timeout: 5000  // 5 秒触发刷新
        }
      }
    }
  }
});
```

- 最大单请求 500 KB，单事件 32 KB
- 超过 500 KB 自动拆分

### 7.5 重试队列

使用 `@segment/localstorage-retry` 包：

- 事件存储在 `localStorage`（不可用时回退到内存）
- 指数退避重试，最多 **10 次**
- 最大队列 **100 个事件**
- 标签页超过 10 秒未更新 ack，其他标签页接管其队列

### 7.6 Cookie / localStorage

| 存储键 | 类型 | 内容 | 过期 |
|--------|------|------|------|
| `ajs_anonymous_id` | Cookie + localStorage | UUID v4 | 1 年 |
| `ajs_user_id` | Cookie + localStorage | `identify()` 传入的 userId | 1 年 |
| `ajs_user_traits` | localStorage | 最近 `identify()` 的 traits JSON | 无过期 |
| `ajs_group_id` | Cookie + localStorage | 分组标识 | 1 年 |

### 7.7 Device Mode vs Cloud Mode

| 方面 | Device Mode | Cloud Mode |
|------|------------|------------|
| 数据请求目标 | 第三方自有端点 | `api.segment.io/v1/track` |
| SDK 加载 | 第三方 SDK 加载到页面 | 仅加载 Segment SDK |
| 中间件支持 | 支持 Destination Middleware | 不支持 |
| 隐私控制 | 未同意时不加载 SDK | 服务端过滤 |

### 7.8 数据格式

标准化 JSON，包含 `type`（track/identify/page/group/alias）、`userId`/`anonymousId`、`properties`/`traits`、`context`（浏览器元数据）、`timestamp`、`messageId`。

### 7.9 识别特征

| 维度 | 特征 |
|------|------|
| 域名 | `api.segment.io`、`cdn.segment.com` |
| 路径 | `/v1/t`、`/v1/p`、`/v1/i`、`/v1/batch` |
| CDN 配置 | `cdn.segment.com/v1/projects/{WRITE_KEY}/settings` |
| Cookie | `ajs_anonymous_id`、`ajs_user_id` |
| 负载 | 含 `anonymousId`、`writeKey`、`messageId` |

---

## 8. Amplitude

### 8.1 SDK 加载方式

通过 JS SDK 或 HTTP API 集成，使用 `api_key` 标识项目。

### 8.2 上报端点

| 端点 | 用途 |
|------|------|
| `POST https://api2.amplitude.com/2/httpapi` | HTTP V2 API（标准） |
| `POST https://api2.amplitude.com/batch` | Batch API（高吞吐） |
| `POST https://api2.amplitude.com/identify` | Identify API（用户属性） |
| `POST https://api2.amplitude.com/groupidentify` | Group Identify API |
| EU 区域 | `https://api.eu.amplitude.com/2/httpapi` |

### 8.3 数据格式

**Track 事件（HTTP V2 API）：**

```json
{
  "api_key": "YOUR_API_KEY",
  "events": [
    {
      "event_type": "watch_tutorial",
      "user_id": "12345",
      "device_id": "C8F9E604-...",
      "time": 1396381378123,
      "session_id": 1396381300000,
      "event_properties": { "source": "notification" },
      "user_properties": { "$set": { "age": 25 } },
      "platform": "iOS",
      "country": "United States"
    }
  ]
}
```

**Identify（单独端点）：**

```
POST /identify
Content-Type: application/x-www-form-urlencoded

api_key=YOUR_KEY&identification=[{"user_id":"user123","user_properties":{"$set":{"plan":"pro"}}}]
```

或通过 HTTP V2 API 使用 `event_type: "$identify"`。

**Revenue 事件：**

```json
{
  "event_type": "revenue_amount",
  "price": 4.99,
  "quantity": 2,
  "revenue": 9.98,
  "productId": "prod_abc123",
  "revenueType": "purchase"
}
```

### 8.4 批量发送与队列

**Browser SDK 2 默认配置：**

| 配置项 | 默认值 |
|-------|--------|
| `flushQueueSize` | 30 事件 |
| `flushIntervalMillis` | 1000 ms (1 秒) |

先到达任一阈值触发发送。

**离线模式（SDK 2.4.0+）：**

- 每次 `track()` 检查 `navigator.onLine`
- 离线时保存到 `AMP_unsent_<api_key>`（localStorage）
- 监听 `online` 事件自动重新发送

### 8.5 Cookie / localStorage

**Cookie 名：** `AMP_<前10位API_KEY>`（Browser SDK 2）或 `amp_<6位>`（旧版 1.x）

**Cookie 内容（点号分隔编码）：** `deviceId`、`userId`（Base64）、`sessionId`、`lastEventTime`、`lastEventId`

**营销归因 Cookie：** `AMP_MKTG_<前10位API_KEY>` — 存储 UTM 参数和来源数据。

### 8.6 会话管理

- Session ID = 会话开始的 Unix 时间戳（毫秒）
- 默认超时：**30 分钟**不活跃
- Cookie 存储 `lastEventTime`，超过超时生成新 `sessionId`

### 8.7 ID 验证

- `device_id` 和 `user_id` 最短 **5 个字符**
- 短于 5 字符的 ID 被从事件中**移除**（事件仍处理）
- 可通过 `minIdLength` 配置覆盖

### 8.8 速率限制

| 限制 | 值 |
|------|---|
| 每用户/设备 | 30 events/秒 |
| 每秒批次 | 100 批次 |
| 每秒事件 | 1000 事件 |
| 单请求 | ≤2000 事件且 <1MB |

### 8.9 识别特征

| 维度 | 特征 |
|------|------|
| 域名 | `api2.amplitude.com` 或 `api.amplitude.com` |
| 路径 | `/2/httpapi`、`/batch`、`/identify`、`/groupidentify` |
| Cookie | `AMP_<API_KEY前缀>`、`AMP_MKTG_<API_KEY前缀>` |
| 负载 | 必含 `api_key` 和 `events` 数组 |

---

## 9. 开源方案

### 9.1 Matomo（前身 Piwik）

#### SDK 加载方式

加载 `matomo.js`（或遗留的 `piwik.js`），通过 `_paq.push()` 配置和触发追踪。Tag Manager 使用 `container_XXXXXXXX.js`。

#### 上报端点

| 端点 | 用途 |
|------|------|
| `https://{domain}/matomo.php` | 标准追踪（新版本） |
| `https://{domain}/piwik.php` | 向后兼容 |
| `https://{domain}/js/` | 脚本服务 |
| `plugins/HeatmapSessionRecording/configs.php` | 热力图/录制配置检查（付费插件） |

#### 发送方式

- 单条：GET 或 POST，参数在 URL query string 中
- 批量：POST JSON body 包含 `requests` 数组

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

#### 关键参数

| 参数 | 含义 |
|------|------|
| `idsite`（必需） | 站点 ID |
| `rec=1`（必需） | 启用追踪标记 |
| `action_name` | 页面标题 |
| `url` | 当前页面 URL |
| `_id` | 访客 ID（16 位十六进制） |
| `rand` | 随机数防缓存 |
| `e_c / e_a / e_n / e_v` | 事件 category/action/name/value |
| `dimension{N}` | 自定义维度（N=管理界面分配的 ID） |
| `c_n / c_p / c_t / c_i` | 内容追踪：name/piece/target/interaction |
| `ping=1` | 心跳请求（仅更新停留时间，不记录新动作） |

#### 心跳计时器

```javascript
_paq.push(['enableHeartBeatTimer', 15]); // 最小 5 秒，默认 15 秒
```

- 不是定时发送 ping，而是在用户离开页面时（标签页失焦、导航、关闭）发送
- 使用 `visibilitychange` 和 `beforeunload` 事件
- 请求附带 `ping=1` 参数

#### Cookie 详情

所有 Cookie 均为第一方，非 HttpOnly：

| Cookie | 过期 | 格式/内容 |
|--------|------|---------|
| `_pk_id.{siteId}.{hash}` | 13 个月 | `{visitorId}.{firstVisitTime}.{visitCount}.{lastVisitTime}.{lastActionTime}` |
| `_pk_ses.{siteId}.{hash}` | 30 分钟 | 会话标记（值为 `1`） |
| `_pk_ref.{siteId}.{hash}` | 6 个月 | JSON 数组 `["campaign","keyword","timestamp","referrer_url"]` |

#### 同意机制

| 方法 | 行为 |
|------|------|
| `requireConsent()` | 阻止**所有**追踪请求，直到 `setConsentGiven()` 或 `rememberConsentGiven()` |
| `requireCookieConsent()` | 追踪请求仍发送，但**不设置** Cookie |

`rememberConsentGiven()` 设置 `_pk_consent` Cookie 持久化同意状态。

#### SPA 追踪

```javascript
_paq.push(['setCustomUrl', window.location.href]);
_paq.push(['setDocumentTitle', document.title]);
_paq.push(['trackPageView']);
```

Tag Manager 使用 `History Change` 触发器（支持 `hashchange`、`replaceState`、`popState`）。

#### 反广告拦截

官方 [matomo-org/tracker-proxy](https://github.com/matomo-org/tracker-proxy) PHP 代理。关键规则：URL 路径避免使用 "matomo" 或 "piwik"（在拦截列表中）。

#### JS 错误追踪

```javascript
_paq.push(['enableJSErrorTracking']);
```

- 钩住 `window.onerror`
- 记录为事件：Category=`JavaScript Errors`，Action=`{URL}:{line}:{col}`

#### 识别特征

| 维度 | 特征 |
|------|------|
| 路径 | `matomo.php` 或 `piwik.php` |
| 参数 | `idsite=` + `rec=1` |
| JS 文件 | `matomo.js` 或 `piwik.js` |
| Cookie | `_pk_id.*`、`_pk_ses.*`、`_pk_ref.*` |

---

### 9.2 Plausible

#### SDK 加载方式

极轻量脚本（<1KB）：

```html
<script src="https://plausible.io/js/script.js" data-domain="your-site.com"></script>
```

#### 脚本变体（模块化扩展）

10 个扩展 token 可组合为 1024 种变体：

| 扩展 | 功能 |
|------|------|
| `hash` | 追踪 `#hash` 片段为独立页面 |
| `outbound-links` | 追踪外部链接点击 |
| `file-downloads` | 自动追踪文件下载（pdf、xlsx、zip 等） |
| `tagged-events` | 通过 CSS class `plausible-event-name=...` 追踪元素 |
| `exclusions` | 支持 localStorage 自排除 |
| `compat` | IE11 兼容（使用 XHR 代替 fetch） |
| `local` | 允许追踪 localhost |
| `manual` | 禁用自动页面浏览追踪 |
| `pageview-props` | 页面浏览携带自定义属性 |
| `revenue` | 收入追踪字段 |

组合示例：`/js/script.hash.outbound-links.revenue.js`

#### 上报端点

- `POST https://plausible.io/api/event`
- 自托管：`POST https://{instance}/api/event`

#### 发送方式

POST 请求，`Content-Type: application/json` 或 `text/plain`。**不使用 Cookie**。

#### 数据格式

**页面浏览：**

```json
{
  "name": "pageview",
  "url": "https://example.com/page",
  "domain": "example.com",
  "referrer": "https://google.com"
}
```

**自定义事件：**

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

#### Cookie-less 追踪机制

```
daily_salt + domain + IP_address + User-Agent → SHA-256 → visitor_hash
```

- `daily_salt` 每 24 小时随机重新生成，旧盐永久删除
- 同一访客同一天 = 相同哈希 = 一个唯一访客
- 跨天无法识别同一访客
- 原始 IP 和 User-Agent **永不**写入日志或数据库

#### 关键 HTTP 头

- `User-Agent`（必需）：设备检测和用户 ID 计算
- `X-Forwarded-For`：代理场景下的真实 IP
- `X-Debug-Request: true`：返回调试响应

#### 代理支持

官方提供 Netlify、Vercel、Cloudflare Workers 等平台的代理配置指南，同时代理脚本文件和 `/api/event` 端点。

#### 识别特征

| 维度 | 特征 |
|------|------|
| 路径 | `/api/event` |
| 脚本 | `/js/script.js`（或变体） |
| HTML | `data-domain` 属性 |
| 特点 | 无 Cookie，无 `token` 参数 |

---

### 9.3 Umami

#### SDK 加载方式

```html
<script src="https://{instance}/script.js" data-website-id="xxx"></script>
```

脚本约 2KB。v2 从 `umami.js` 改名为 `script.js`。

#### 上报端点

- v2：`POST https://{instance}/api/send`
- v1（遗留）：`POST https://{instance}/api/collect`
- 可通过 `COLLECT_API_ENDPOINT` 环境变量自定义

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

- 页面浏览：`type: "event"` 且无 `name`/`data` 字段
- 自定义事件：包含 `name` 和 `data`

**自定义事件数据约束：** 数值最多 4 位小数，字符串最长 500 字符，对象最多 50 个顶级属性。

#### Bot 检测

使用 `isbot` npm 包服务端检测。Bot 请求返回 `{"beep": "boop"}`（HTTP 200），不存储数据。

#### 反广告拦截

| 环境变量 | 作用 |
|---------|------|
| `TRACKER_SCRIPT_NAME` | 重命名 `/script.js` 为自定义路径 |
| `COLLECT_API_ENDPOINT` | 自定义上报路径 |

#### 自托管关键配置

| 变量 | 影响 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接 |
| `CLICKHOUSE_URL` | 可选 ClickHouse 分析查询 |
| `TRACKER_SCRIPT_NAME` | 自定义追踪脚本名 |
| `COLLECT_API_ENDPOINT` | 自定义采集端点 |
| `ALLOW_INSECURE_LOCALHOST` | 允许 localhost 追踪 |
| `REDIS_URL` | 启用 Redis 缓存 |

#### 数据保留

Umami **不提供**自动数据保留策略。需手动通过 API（`POST /api/websites/{id}/reset`）或数据库级 SQL 清理。

#### 识别特征

| 维度 | 特征 |
|------|------|
| 路径 | `/api/send`（v2）、`/api/collect`（v1） |
| HTML | `data-website-id` 属性 |
| 负载 | `website` 字段（UUID 格式） |
| 特点 | 无 Cookie |

---

### 9.4 PostHog

#### SDK 加载方式

通过 JS SDK snippet 或 npm 包集成，使用 Project API Key（`phc_` 前缀）初始化。

#### 上报端点

| 端点 | 用途 |
|------|------|
| `POST /i/v0/e` | 事件采集（新版本） |
| `POST /capture` | 事件采集（旧版兼容） |
| `POST /batch/` | 批量上报 |
| `POST /s/` | Session Replay |
| `POST /decide/?v=3` | Feature Flags / 远程配置 |
| `GET /array/{token}/config` | 远程配置 |
| US Cloud | `https://us.i.posthog.com` |
| EU Cloud | `https://eu.i.posthog.com` |

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

#### Autocapture

自动捕获 `click`、`change`、`submit` 事件，发送 `$autocapture` 事件：

```json
{
  "event": "$autocapture",
  "properties": {
    "$event_type": "click",
    "$elements": [
      {
        "tag_name": "button",
        "classes": ["btn", "btn-primary"],
        "attr__id": "submit-btn",
        "$el_text": "Subscribe Now"
      }
    ],
    "$elements_chain": "button.btn.btn-primary:attr__id=\"submit-btn\"..."
  }
}
```

**配置选项：** `dom_event_allowlist`、`element_allowlist`、`css_selector_allowlist`、`element_attribute_ignorelist`

#### Feature Flags（`/decide` 端点）

**请求：**

```json
{
  "token": "phc_xxxxx",
  "distinct_id": "user_123",
  "groups": {"company": "company_id"},
  "person_properties": {"plan": "premium"}
}
```

**响应（v3）：**

```json
{
  "featureFlags": { "flag-key": true, "multivariate-flag": "variant-b" },
  "featureFlagPayloads": { "flag-key": "{\"color\": \"blue\"}" },
  "sessionRecording": { "endpoint": "/s/", "consoleLogRecordingEnabled": true },
  "supportedCompression": ["gzip", "gzip-js"],
  "capturePerformance": true
}
```

#### Session Replay（`/s/` 端点）

基于 **rrweb** 录制：

- `type: 2` — 完整 DOM 快照
- `type: 3` — 增量快照（DOM 变化、鼠标移动、滚动、输入）
- `type: 5` — 自定义事件（控制台日志、网络请求）

存储格式：换行分隔 JSON `[windowId, rrwebEvent]\n`

#### 压缩选项

| 选项 | 状态 | 说明 |
|------|------|------|
| `gzip-js` | 当前 | 使用 Compression Streams API |
| `lz64` | v2.0 移除 | 因增大库体积被移除 |
| `base64` | 回退 | 浏览器不支持 gzip 时 |

#### Person Properties

```json
{
  "event": "$identify",
  "distinct_id": "user_123",
  "properties": {
    "$set": { "email": "user@example.com", "plan": "premium" },
    "$set_once": { "first_seen_url": "https://example.com/landing" }
  }
}
```

#### Dead Click 检测

- 监控点击后 ~750ms 内是否有 DOM 变化
- 无变化则分类为 `$dead_click` 事件
- Toolbar 支持 dead click 热力图可视化

#### Web Vitals

```javascript
posthog.init('phc_xxxxx', { capture_performance: true });
```

发送 `$web_vitals` 事件，包含：

| 属性键 | 指标 |
|--------|------|
| `$web_vitals_LCP_value` | Largest Contentful Paint (ms) |
| `$web_vitals_INP_value` | Interaction to Next Paint (ms) |
| `$web_vitals_CLS_value` | Cumulative Layout Shift |
| `$web_vitals_FCP_value` | First Contentful Paint (ms) |

SDK 等待页面加载后最多 5 秒收集所有指标，合并为单个事件发送。

#### 识别特征

| 维度 | 特征 |
|------|------|
| 路径 | `/i/v0/e`、`/capture`、`/batch/`、`/decide/`、`/s/` |
| 域名 | `posthog.com`、`i.posthog.com` |
| 负载 | `api_key`（以 `phc_` 开头）或 `token` |
| Cookie | 可选 |

---

## 10. ByteDance DataRangers（火山引擎）

### 10.1 SDK 加载方式

Web SDK 以 npm 包 `@datarangers/sdk-javascript` 提供：

```javascript
SDK.init({
  app_id: 12345,
  channel: 'cn',       // 'cn' 国内，'sg' 新加坡
  log: false
});
SDK.config({ user_unique_id: 'user123' });
```

### 10.2 上报端点

| 域名 | 用途 |
|------|------|
| `mcs.zijieapi.com` | 主数据采集（国内） |
| `applog.zijieapi.com` | 应用日志 |
| `mcs.tobsnssdk.com` | 国际/海外数据采集 |

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

请求约束：每请求最多 20 个事件。

**必需 HTTP 头：**

```
Content-Type: application/json
X-MCS-AppKey: {app_key_string}
```

### 10.4 设备标识

通过浏览器指纹（canvas、字体、屏幕属性）生成 `web_id`，存储在 `localStorage`。移动端使用 IDFA/IMEI/Android ID + CAID 回退。

### 10.5 批量发送

- `/list` 端点名反映批量模式
- 默认批量大小：最多 20 个事件
- 刷新间隔：约 5–15 秒

### 10.6 识别特征

| 维度 | 特征 |
|------|------|
| 域名 | `mcs.zijieapi.com`、`applog.zijieapi.com`、`mcs.tobsnssdk.com` |
| 路径 | `/list`，含 `aid=` 和 `sdk_version=` 参数 |
| HTTP 头 | `X-MCS-AppKey` |
| 负载 | `events` 数组，`header.app_id`，`user.user_unique_id` |

> **注：** Tea Event Radar 当前的 `POST + URL 含 "list"` 拦截规则即针对此平台设计。

---

## 11. TikTok Pixel

### 11.1 SDK 加载方式

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
| `https://analytics.tiktok.com/i18n/pixel/events.js` | SDK 交付 |
| `https://analytics.tiktok.com/api/v2/pixel` | 客户端事件采集 |
| `https://business-api.tiktok.com/open_api/v1.2/pixel/track/` | 服务端 Events API (CAPI) |

### 11.3 标准事件类型

`PageView`、`ViewContent`、`AddToCart`、`InitiateCheckout`、`AddPaymentInfo`、`Purchase`、`PlaceAnOrder`、`Subscribe`、`Search`、`Contact`、`Download`

### 11.4 Cookie

| Cookie | 过期 | 用途 |
|--------|------|------|
| `_ttp` | 1 年 | 第一方点击/浏览归因，关联 TikTok 广告交互 |

### 11.5 识别特征

| 维度 | 特征 |
|------|------|
| 脚本域名 | `analytics.tiktok.com` |
| 全局变量 | `window.ttq` |
| Cookie | `_ttp` |
| 网络请求 | `analytics.tiktok.com/api/v2/pixel` |

---

## 12. Heap Analytics

### 12.1 SDK 加载方式

```javascript
window.heap = window.heap || [];
window.heap.load("YOUR_APP_ID");
```

CDN：`https://cdn.us.heap-api.com/heap.js`（US）/ `https://cdn.eu.heap-api.com/heap.js`（EU）

### 12.2 上报端点

- US：`https://c.us.heap-api.com`
- EU：`https://c.eu.heap-api.com`

### 12.3 自动捕获机制

通过事件委托拦截 `click`、`submit`、`change`、`touchstart`，以及 `pushState`/`replaceState`/`popstate`/`hashchange` 页面导航。无需代码埋点，支持通过管理界面回溯定义 **Virtual Events**。

### 12.4 Cookie

| Cookie | 过期 | 用途 |
|--------|------|------|
| `_hp2_id.{app_id}` | 13 个月 | 持久用户标识 |
| `_hp2_ses_props.{app_id}` | 30 分钟 | 当前会话属性 |
| `_hp2_props.{app_id}` | 13 个月 | 事件属性 |
| `_hp2_hld` | 瞬时 | 域名检测 |

### 12.5 识别特征

| 维度 | 特征 |
|------|------|
| CDN | `cdn.us.heap-api.com`、`cdn.eu.heap-api.com` |
| 数据采集 | `c.us.heap-api.com`、`c.eu.heap-api.com` |
| 全局变量 | `window.heap` |
| Cookie | `_hp2_id.*`、`_hp2_ses_props.*` |

---

## 13. Hotjar

### 13.1 SDK 加载方式

```javascript
window._hjSettings = { hjid: SITE_ID, hjsv: 6 };
// 动态加载 https://static.hotjar.com/c/hotjar-{SITE_ID}.js?sv={VERSION}
```

### 13.2 上报端点

| 端点 | 用途 |
|------|------|
| `https://static.hotjar.com/c/hotjar-{ID}.js` | SDK 脚本 |
| `wss://ws.hotjar.com/api/v2/client/ws` | WebSocket 会话录制数据 |
| `https://vc.hotjar.io` | 录制数据提交 |
| `https://in.hotjar.com` | 事件采集 |

### 13.3 录制机制

基于 **rrweb** DOM 序列化：

1. 会话开始时捕获完整 DOM 快照
2. `MutationObserver` 监控后续 DOM 变化
3. 鼠标位置每 100ms 采样（10Hz）
4. 数据通过 **WebSocket** 流式传输

### 13.4 Cookie

| Cookie | 过期 | 用途 |
|--------|------|------|
| `_hjSessionUser_{SITE_ID}` | 1 年 | 持久用户 ID |
| `_hjSession_{SITE_ID}` | 30 分钟 | 当前会话数据 |
| `_hjid` | 1 年 | 遗留用户 ID |
| `_hjSessionResumed` | 会话 | 录制重连标记 |

### 13.5 识别特征

| 维度 | 特征 |
|------|------|
| 脚本 | `static.hotjar.com/c/hotjar-*.js` |
| 全局变量 | `window.hj` |
| 配置 | `window._hjSettings` |
| WebSocket | `ws.hotjar.com` |
| Cookie | `_hjSessionUser_*`、`_hjSession_*` |

---

## 14. Microsoft Clarity

### 14.1 SDK 加载方式

```javascript
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "PROJECT_ID");
```

### 14.2 上报端点

| 端点 | 用途 |
|------|------|
| `https://www.clarity.ms/tag/{PROJECT_ID}` | SDK 脚本 |
| `https://www.clarity.ms/collect` | 数据上传 |

### 14.3 数据格式与编码

多层编码：

```
数据采集 → clarity-js encode() 序列化 → gzip 压缩 → XHR POST（原始二进制）
```

- Content body 为 **gzip 压缩的原始二进制**（非 base64，非 JSON）
- 数值使用 base-36 编码（`num.toString(36)`）减少体积
- 默认所有文本内容**被遮罩**，使用 `data-clarity-unmask` 属性选择性暴露

**元数据字段：** `userId`、`sessionId`、`pageNum`、`url`、`referrer`、`pageTitle`、`tabId`、`userAgent`、`screenDimensions`、`deviceMemory`、`hardwareConcurrency`、`language`、`platform`、`timezone`

### 14.4 Cookie

| Cookie | 类型 | 过期 | 用途 |
|--------|------|------|------|
| `_clck` | 第一方 | 1 年 | Clarity 用户 ID |
| `_clsk` | 第一方 | 1 天 | 会话分组 |
| `CLID` | 第三方 | 永久 | 跨站用户标识 |
| `MUID` | 第三方 | 1 年 | Microsoft 全产品线浏览器标识 |
| `ANONCHK` | 第三方 | 会话 | MUID 到 ANID 转移标记 |
| `MR` | 第三方 | 1 周 | MUID 刷新标记 |
| `SM` | 第三方 | 会话 | 跨域同步标记 |

### 14.5 识别特征

| 维度 | 特征 |
|------|------|
| 脚本 | `www.clarity.ms/tag/{ID}` |
| 上传 | `www.clarity.ms/collect` |
| 全局函数 | `window.clarity` |
| Cookie | `_clck`、`_clsk`（第一方）；`MUID`、`CLID`（第三方） |
| 上传格式 | 原始 gzip 二进制 |

---

## 15. Adobe Analytics

### 15.1 实现版本

| 库 | JS 对象 | 时期 |
|----|---------|------|
| `s_code.js` (遗留) | `window.s` | 2012 年前（已淘汰） |
| `AppMeasurement.js` | `window.s` | 2012 至今（仍广泛部署） |
| `alloy.js` (AEP Web SDK) | `window.alloy` | 2019 至今（当前推荐） |

### 15.2 AppMeasurement.js（经典方案）

**追踪端点模式：**

```
https://{tracking_server}/b/ss/{report_suite_id}/{hit_source}/{cache_buster}?{query_string}
```

示例：

```
https://company.sc.omtrdc.net/b/ss/prodglobal/1/s12345678?pageName=Home&v5=LoggedIn
```

- `/b/ss/` — 所有 Analytics 图片请求的固定路径
- `{hit_source}` — `/1/` 页面浏览，`/5/` 链接追踪
- tracking server：`{company}.sc.omtrdc.net`（第三方）或 `metrics.{company}.com`（CNAME 第一方）

**关键请求参数：**

| 参数 | 说明 |
|------|------|
| `pageName` | 页面名称维度 |
| `g` | 页面 URL（前 255 字节） |
| `-g` | URL 溢出（255+ 字节） |
| `r` | Referrer URL |
| `t` | 时间戳 `dd/mm/yyyy hh:mm:ss weekday gmtoffset` |
| `mid` | Experience Cloud Visitor ID (ECID) |
| `v1`–`v250` | eVars（转化变量） |
| `c1`–`c75` | Props（流量变量） |
| `events` | 事件列表（如 `event1,purchase`） |
| `products` | 产品字符串 |
| `AQB` / `AQE` | 查询字符串定界符 |

**Cookie：**

| Cookie | 域 | 过期 | 用途 |
|--------|---|------|------|
| `s_vi` | 第一方(CNAME) 或 `omtrdc.net` | 2 年 | 主访客 ID + 时间戳 |
| `s_fid` | 第一方 | 2 年 | 回退访客 ID |
| `s_ecid` | 第一方 | 13 个月 | ECID 镜像 |
| `AMCV_{org_id}` | 第一方 | 2 年 | Experience Cloud Visitor ID 存储 |
| `demdex` | `.demdex.net` | 180 天 | 跨域访客 ID（Audience Manager） |

### 15.3 AEP Web SDK（alloy.js）

**端点：**

```
POST https://edge.adobedc.net/ee/{datastreamId}/v1
```

所有数据发送到单一端点，由 Edge Network 路由到 Analytics、Target 等产品。

**请求格式（XDM Schema）：**

```json
{
  "xdm": {
    "eventType": "web.webpagedetails.pageViews",
    "web": {
      "webPageDetails": { "URL": "https://example.com/page", "name": "Page Name" }
    }
  },
  "data": {
    "__adobe": {
      "analytics": { "pageName": "Page Name", "eVar5": "CustomValue" }
    }
  }
}
```

### 15.4 识别特征

| 版本 | 特征 |
|------|------|
| AppMeasurement | URL 含 `/b/ss/`，域名 `*.sc.omtrdc.net`，全局 `window.s`，Cookie `s_vi`/`AMCV_*` |
| alloy.js (AEP) | URL 含 `edge.adobedc.net/ee/`，POST JSON，全局 `window.alloy` |

---

## 16. 汇总对比表

| 平台 | 采集端点示例 | 默认发送方式 | 数据编码 | Cookie | 识别关键词 |
|------|-------------|-------------|---------|--------|-----------|
| **神策** | `/sa?project=xxx` | Image GET / POST / Beacon | Base64+Gzip JSON | 有 | `sa?project=`, `sensorsdata` |
| **GA4 Client** | `/g/collect` | GET query / Beacon POST | URL-encoded KV | 有 | `g/collect`, `tid=G-` |
| **GA4 MP** | `/mp/collect` | POST JSON | JSON | 无 | `mp/collect`, `api_secret` |
| **百度统计** | `/hm.gif` | Image GET | URL query params | 有 | `hm.baidu.com`, `hm.gif`, `si=` |
| **GrowingIO** | `/v3/projects/*/collect` | POST JSON/Protobuf | gzip+JSON 或 Protobuf | 有 | `growingio.com`, `eventType`, `grwng_uid` |
| **Mixpanel** | `/track/` | POST（默认）/ Beacon | JSON | 有 | `mixpanel.com`, `/track/`, `token` |
| **Segment** | `/v1/t`, `/v1/batch` | POST JSON | JSON | 有 | `api.segment.io`, `anonymousId` |
| **Amplitude** | `/2/httpapi` | POST JSON | JSON | 可选 | `amplitude.com`, `api_key` |
| **Matomo** | `matomo.php` | GET query / POST JSON batch | URL query / JSON | 有 | `matomo.php`, `idsite=`, `rec=1` |
| **Plausible** | `/api/event` | POST JSON | JSON | 无 | `/api/event`, `data-domain` |
| **Umami** | `/api/send` | POST JSON | JSON | 无 | `/api/send`, `data-website-id` |
| **PostHog** | `/i/v0/e`, `/batch/` | POST JSON | JSON (支持压缩) | 可选 | `/i/v0/e`, `phc_`, `/batch/` |
| **DataRangers** | `/list?aid=` | POST JSON | JSON | 可选 | `zijieapi.com`, `/list`, `X-MCS-AppKey` |
| **TikTok Pixel** | `/api/v2/pixel` | POST JSON | JSON | 有 | `analytics.tiktok.com`, `_ttp`, `ttq` |
| **Heap** | `c.us.heap-api.com` | POST JSON | JSON | 有 | `heap-api.com`, `_hp2_id.*` |
| **Hotjar** | `ws.hotjar.com` (WS) | WebSocket 流式 | 二进制 (rrweb) | 有 | `hotjar.com`, `_hjSession*`, `window.hj` |
| **Clarity** | `/collect` | POST binary | gzip 二进制 | 有 | `clarity.ms`, `_clck`, `_clsk` |
| **Adobe (AM)** | `/b/ss/{rsid}/` | GET image | URL query params | 有 | `/b/ss/`, `omtrdc.net`, `s_vi` |
| **Adobe (AEP)** | `edge.adobedc.net/ee/` | POST JSON | JSON (XDM) | 有 | `adobedc.net`, `window.alloy` |

---

## 17. 请求拦截识别建议

如需在网关或前端层面识别和拦截这些埋点请求，建议按以下维度组合匹配：

### 17.1 域名匹配

```
# 商业平台
google-analytics.com | hm.baidu.com | api-js.mixpanel.com | api.mixpanel.com
api.segment.io | cdn.segment.com | api2.amplitude.com | api.amplitude.com
growingio.com | napi.growingio.com | analytics.tiktok.com
mcs.zijieapi.com | mcs.tobsnssdk.com | applog.zijieapi.com
cdn.us.heap-api.com | c.us.heap-api.com | cdn.eu.heap-api.com | c.eu.heap-api.com
static.hotjar.com | ws.hotjar.com | vc.hotjar.io | in.hotjar.com
www.clarity.ms | *.sc.omtrdc.net | edge.adobedc.net
*.cloud.sensorsdata.cn | *.datasink.sensorsdata.cn

# 开源/自托管（需根据部署确认）
# matomo.php / piwik.php (自定义域名)
# plausible.io 或自托管域名
# umami 自托管域名
# posthog.com 或自托管域名
```

### 17.2 路径匹配

```
/sa?                    # 神策
/g/collect              # GA4 Client
/mp/collect             # GA4 Measurement Protocol
/collect                # UA (遗留)
/hm.gif                 # 百度统计
/v3/projects/*/collect  # GrowingIO
/track/                 # Mixpanel
/engage/                # Mixpanel 用户属性
/record/                # Mixpanel Session Replay
/v1/t | /v1/p | /v1/i | /v1/batch  # Segment
/2/httpapi | /batch     # Amplitude
/identify               # Amplitude Identify
matomo.php | piwik.php  # Matomo
/api/event              # Plausible
/api/send               # Umami
/i/v0/e | /capture | /batch/ | /decide/ | /s/  # PostHog
/list                   # DataRangers (火山引擎)
/api/v2/pixel           # TikTok Pixel
/b/ss/                  # Adobe Analytics (AppMeasurement)
/ee/                    # Adobe Analytics (AEP)
/collect                # Microsoft Clarity
```

### 17.3 参数/负载匹配

| 特征参数 | 平台 |
|---------|------|
| `tid=G-` | GA4 |
| `v=2` (GA4) / `v=1` (UA) | Google Analytics |
| `si=`（32位hex） | 百度统计 |
| `api_key=` | Amplitude |
| `idsite=` + `rec=1` | Matomo |
| `data-domain=` | Plausible |
| `data-website-id=` | Umami |
| `api_key` 以 `phc_` 开头 | PostHog |
| `aid=` + `sdk_version=` | DataRangers |
| `X-MCS-AppKey` 请求头 | DataRangers |

### 17.4 Content-Type 分布

| Content-Type | 平台 |
|-------------|------|
| Image GET (image/gif) | 神策(默认)、百度统计、Adobe AppMeasurement |
| `application/json` POST | Mixpanel、Segment、Amplitude、GrowingIO、PostHog、Plausible、Umami、TikTok、Adobe AEP |
| `text/plain` POST | 神策(ajax/beacon)、部分 Plausible 配置 |
| WebSocket 二进制 | Hotjar |
| gzip 二进制 POST | Microsoft Clarity |
| `application/x-protobuf` | GrowingIO (Protobuf 模式) |
| `application/octet-stream` | Mixpanel Session Replay |

---

## 附录 A：Tea Event Radar 拦截规则适配

当前 Tea Event Radar 的拦截规则为 `POST 方法 + URL 包含 "list"`，主要针对火山引擎 DataRangers SDK 设计。

如需扩展覆盖范围，建议按以下优先级增加规则：

| 优先级 | 规则 | 覆盖平台 |
|-------|------|---------|
| P0（当前） | POST + URL 含 `list` | DataRangers |
| P1 | POST + URL 含 `/track` | Mixpanel |
| P1 | POST + URL 含 `/collect` | GA4 MP, Clarity |
| P1 | POST + URL 含 `/batch` | Segment, Amplitude, PostHog |
| P2 | POST + URL 含 `/api/event` | Plausible |
| P2 | POST + URL 含 `/api/send` | Umami |
| P2 | POST + URL 含 `/capture` 或 `/i/v0/e` | PostHog |
| P2 | POST + URL 含 `/sa?` | 神策 |
| P3 | GET + URL 含 `/g/collect` | GA4 Client |
| P3 | GET + URL 含 `/hm.gif` | 百度统计 |
| P3 | GET + URL 含 `/b/ss/` | Adobe AppMeasurement |
| P3 | POST + URL 含 `matomo.php` 或 `piwik.php` | Matomo |

---

## 附录 B：版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-03-20 | 初始版本：覆盖 17 个主流埋点平台的上报请求特征 |
