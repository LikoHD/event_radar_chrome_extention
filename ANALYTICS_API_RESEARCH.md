# 主流埋点上报 API 特征调研

> 调研目的：梳理市面上主流埋点平台的上报接口特征（URL、参数、格式），为 Event Radar 扩展支持多平台埋点识别提供依据。

---

## 一、火山引擎 Rangers / Tea SDK（字节跳动）

### 上报端点

| 环境 | Endpoint |
|------|----------|
| SaaS（非云原生） | `https://mcs.volceapplog.com/sdk/app/batch` |
| SaaS（云原生） | `https://gator.volces.com/sdk/app/batch` |
| 国内 App Log | `https://log.byteoversea.com/sdk/app/batch` |
| 私有化 | 自定义域名 + `/sdk/app/batch` 或 `/v2/event/list` |

- **HTTP 方法**：POST
- **Content-Type**：`application/json`
- **URL 特征**：路径含 `/sdk/app/batch` 或 `/v2/event/list`（当前扩展靠 `list` 匹配命中此路径）

### 请求 Headers

```
Content-Type: application/json
X-MCS-AppKey: <AppKey>         # 应用标识
User-Agent: <UA>
```

### 请求 Body 结构（JSON Array）

```json
[
  {
    "user": {
      "user_unique_id": "用户唯一ID"
    },
    "header": {
      "app_id": "12345678",
      "app_name": "your_app_name",
      "os_name": "android",
      "os_version": "12",
      "device_model": "Pixel 6",
      "app_version": "1.0.0",
      "sdk_version": "5.8.8",
      "custom": {
        "自定义公共属性": "value"
      }
    },
    "events": [
      {
        "event": "event_name",
        "params": "{\"key\":\"value\"}",
        "local_time_ms": 1710000000000
      }
    ]
  }
]
```

### 关键参数说明

| 参数 | 含义 |
|------|------|
| `user.user_unique_id` | 用户唯一标识（登录用户ID） |
| `header.app_id` | 应用 ID（类似 Tracking ID） |
| `header.app_name` | 应用名称 |
| `header.os_name` | 操作系统 |
| `events[].event` | 事件名 |
| `events[].params` | 事件属性（JSON 序列化字符串） |
| `events[].local_time_ms` | 事件发生时间戳（毫秒） |

### 批量规则
- 单次最多 **50 条**事件（超出返回 413）
- 建议每批 ≤20 条
- Web SDK 默认 30ms 聚合窗口，或达到 10 条立即上报

---

## 二、神策数据（Sensors Analytics）

### 上报端点

| 类型 | Endpoint |
|------|----------|
| Cloud（推荐） | `http://{service}.datasink.sensorsdata.cn/sa?project={name}&token={token}` |
| Cloud（带端口） | `http://{service}.cloud.sensorsdata.cn:8106/sa?project={name}&token={token}` |
| 私有化 | `http://{host}:8106/sa?project={name}` |
| Web GET 方式 | `http://{host}/sa.gif?project={name}&data={encoded}` |

- **HTTP 方法**：POST（主流）/ GET（Web 像素打点降级）
- **URL 特征**：路径为 `/sa` 或 `/sa.gif`，URL 含 `sensorsdata.cn`

### 请求 Body 格式

数据需经三步编码：

```
原始 JSON → Gzip 压缩 → Base64 编码 → URL Encode
```

POST body：
```
gzip=1&data_list=H4sIAFsmElcAA4vmUgCC...（Base64+UrlEncode 后的数据）
```

或不压缩：
```
gzip=0&data_list=W3siZGlzdGluY3RfaWQi...
```

### 事件 JSON 结构

```json
[
  {
    "distinct_id": "2b0a6f51a3cd6775",
    "time": 1434556935000,
    "type": "track",
    "event": "ViewProduct",
    "properties": {
      "$app_version": "1.0",
      "$os": "iOS",
      "$model": "iPhone 14",
      "product_name": "苹果",
      "product_price": 14
    }
  },
  {
    "distinct_id": "user_12345",
    "type": "profile_set",
    "time": 1435290195610,
    "properties": {
      "Age": 33,
      "VIP": true
    }
  }
]
```

### 关键参数说明

| 参数 | 含义 |
|------|------|
| `distinct_id` | 用户唯一标识（匿名或登录ID） |
| `time` | 事件时间戳（毫秒） |
| `type` | 数据类型：`track`（事件）/ `profile_set`（用户属性）等 |
| `event` | 事件名 |
| `properties` | 事件属性对象（含预置 `$` 前缀属性） |

### URL 参数

| 参数 | 含义 |
|------|------|
| `project` | 项目名称 |
| `token` | 项目 Token（Cloud 版必填） |
| `gzip` | `1`=压缩，`0`=不压缩 |
| `data_list` | 编码后的事件数据 |

---

## 三、百度统计（Baidu Tongji / hm.js）

### 上报端点

```
GET https://hm.baidu.com/hm.gif?{参数列表}
```

- **HTTP 方法**：GET（图片像素打点）
- **URL 特征**：`hm.baidu.com/hm.gif`，通过查询字符串传参

### 请求 URL 示例

```
https://hm.baidu.com/hm.gif?cc=0&ck=1&cl=24-bit&ds=1440x900&ep=7626,3009&et=3&fl=29.0&ja=0&ln=zh-cn&lt=1524041576&rnd=1839110354&si=<site_id>&su=<referrer>&v=1.2.30&u=<current_url>
```

### 关键参数说明

| 参数 | 含义 |
|------|------|
| `si` | 站点 ID（AppKey，在 `hm.js?<si>` 中也体现） |
| `u` | 当前页面 URL |
| `su` | 来源页面（document.referrer） |
| `lt` | Unix 时间戳（秒） |
| `rnd` | 10位随机数（防缓存） |
| `v` | SDK 版本（如 `1.2.30`） |
| `ds` | 屏幕分辨率（如 `1440x900`） |
| `cl` | 颜色深度（如 `24-bit`） |
| `ln` | 浏览器语言（如 `zh-cn`） |
| `fl` | Flash 版本 |
| `ck` | 是否支持 Cookie（1/0） |
| `ja` | 是否支持 Java（1/0） |
| `ep` | 停留时间（格式：`当前时间ms,另一时间ms`） |
| `et` | 事件类型（0=PV，3=离开事件） |
| `cc` | 保密标识 |

### 自定义事件上报（`_trackEvent`）

JS 调用方式（不直接体现在网络请求中，通过 hm.js 中转）：

```js
_hmt.push(['_trackEvent', category, action, opt_label, opt_value]);
// 示例：
_hmt.push(['_trackEvent', 'button', 'click', '购买按钮', 1]);
```

实际网络请求仍走 `hm.gif`，在 `et` 参数中区分事件类型。

---

## 四、Google Analytics（GA4 + Universal Analytics）

### GA4（`gtag.js`）浏览器自动上报

**Endpoint（浏览器自动）：**
```
POST https://www.google-analytics.com/g/collect
```

**URL 参数（Query String）：**

| 参数 | 含义 |
|------|------|
| `v` | 协议版本（GA4 = `2`） |
| `tid` | Tracking ID（如 `G-XXXXXXX`） |
| `cid` | Client ID（浏览器唯一标识） |
| `en` | Event Name（如 `page_view`，`click`） |
| `sid` | Session ID |
| `dl` | Document Location（页面 URL） |
| `dt` | Document Title（页面标题） |
| `ul` | 用户语言 |
| `sr` | 屏幕分辨率 |
| `_s` | Hit 序号 |
| `ep.*` | 事件参数（如 `ep.button_text=立即购买`） |
| `up.*` | 用户属性 |

### GA4 Measurement Protocol（服务端上报）

**Endpoint：**
```
POST https://www.google-analytics.com/mp/collect?measurement_id=G-XXXXX&api_secret=XXXXX
```

**请求 Body（JSON）：**
```json
{
  "client_id": "CLIENT_ID",
  "timestamp_micros": 1710000000000000,
  "events": [
    {
      "name": "purchase",
      "params": {
        "transaction_id": "T_12345",
        "value": 99.99,
        "currency": "CNY"
      }
    }
  ]
}
```

### Universal Analytics（已停用，2024年完全关闭）

**Endpoint（历史参考）：**
```
GET/POST https://www.google-analytics.com/collect
```

| 参数 | 含义 |
|------|------|
| `v` | 协议版本（UA = `1`） |
| `t` | Hit 类型（`pageview`/`event`/`timing`等） |
| `tid` | Tracking ID（`UA-XXXXXX-1`） |
| `cid` | Client ID |
| `ec` | Event Category |
| `ea` | Event Action |
| `el` | Event Label |
| `ev` | Event Value |
| `dp` | Document Path |

---

## 五、Mixpanel

### 上报端点

| 接口 | Endpoint | 场景 |
|------|----------|------|
| 实时上报 | `POST https://api.mixpanel.com/track` | 客户端实时事件（5天内） |
| 批量导入 | `POST https://api.mixpanel.com/import` | 服务端历史数据导入 |
| 用户属性 | `POST https://api.mixpanel.com/engage` | 设置用户属性 |

- **HTTP 方法**：POST
- **Content-Type**：`application/json` 或 `application/x-ndjson`
- **认证**：Basic Auth（`token:` 或 `api_secret:`）

### 请求 Body（JSON Array）

```json
[
  {
    "event": "Purchase",
    "properties": {
      "token": "PROJECT_TOKEN",
      "distinct_id": "user_12345",
      "time": 1710000000,
      "$insert_id": "uuid-1234-5678",
      "$browser": "Chrome",
      "$os": "Windows",
      "product_name": "Pro Plan",
      "price": 99
    }
  }
]
```

### 关键参数说明

| 参数 | 含义 |
|------|------|
| `event` | 事件名 |
| `properties.token` | 项目 Token（Project Token） |
| `properties.distinct_id` | 用户唯一标识 |
| `properties.time` | Unix 时间戳（秒） |
| `properties.$insert_id` | 事件去重 ID（UUID） |
| `properties.$browser` | 浏览器信息 |
| `properties.$os` | 操作系统 |

### 限制
- 单次最多 **2000 条**事件，**10MB** 未压缩
- `/track` 接口仅接受 **5天内**的数据；历史数据用 `/import`

---

## 六、友盟（Umeng+）

### 上报端点

| 域名 | 用途 |
|------|------|
| `https://alog.umeng.com/app_logs` | App 主日志上报 |
| `https://ulogs.umeng.com/` | 备用日志上报 |
| `https://errlog.umeng.com/` | 错误日志上报 |
| `https://uat.umtrack.com/` | 新版 U-Track 上报 |

- **HTTP 方法**：POST
- **Content-Type**：`application/json`
- **特殊 Header**：`X-Umeng-Sdk: os=Android&app_version=1.0&model=Pixel6`

### 请求 Body 结构

```json
{
  "header": {
    "appkey": "596087883eae2574b10013a3",
    "app_version": "1.0",
    "sdk_version": "6.1.1",
    "os": "Android",
    "package_name": "com.example.app",
    "device_model": "Pixel 6",
    "device_manufacturer": "Google",
    "resolution": "2340x1080",
    "cpu": "arm64-v8a",
    "carrier": "China Mobile",
    "access": "WiFi",
    "timezone": 8,
    "country": "CN",
    "device_id": "IMEI_OR_ANDROID_ID",
    "req_time": 1710000000000
  },
  "body": {
    "events": [
      {
        "ts": 1710000000000,
        "et": "custom",
        "tag": "event_label",
        "du": 0
      }
    ]
  }
}
```

### 关键参数说明

| 参数 | 含义 |
|------|------|
| `header.appkey` | 应用唯一标识 |
| `header.device_id` | 设备 ID（IMEI / Android ID） |
| `header.access` | 网络类型（WiFi/4G等） |
| `body.events[].ts` | 事件时间戳（毫秒） |
| `body.events[].et` | 事件类型 |
| `body.events[].tag` | 事件标签/名称 |

---

## 七、腾讯移动分析（MTA / 已停用）

> **注意**：腾讯 MTA（mta.qq.com）已于 2022 年底停止服务，现已整合进腾讯云 QAPM 等工具。

**历史 Endpoint（参考）：**
```
GET https://pingfore.qq.com/pingd?dm=xxx&path=xxx&
POST https://mta.qq.com/h5/api/rqd_batch_upload
```

---

## 八、Amplitude

### 上报端点

```
POST https://api2.amplitude.com/2/httpapi
```

- **HTTP 方法**：POST
- **Content-Type**：`application/json`

### 请求 Body

```json
{
  "api_key": "YOUR_API_KEY",
  "events": [
    {
      "user_id": "user_12345",
      "device_id": "device_abc",
      "event_type": "Button Clicked",
      "time": 1710000000000,
      "event_properties": {
        "button_name": "Submit",
        "page": "checkout"
      },
      "user_properties": {
        "plan": "pro"
      },
      "app_version": "1.0.0",
      "platform": "Web",
      "os_name": "Chrome",
      "country": "China"
    }
  ]
}
```

### 关键参数

| 参数 | 含义 |
|------|------|
| `api_key` | 项目 API Key |
| `events[].user_id` | 用户 ID（登录后） |
| `events[].device_id` | 设备 ID（匿名时使用） |
| `events[].event_type` | 事件名 |
| `events[].time` | 时间戳（毫秒） |
| `events[].event_properties` | 事件属性 |
| `events[].user_properties` | 用户属性（随事件上报） |

---

## 综合对比

| 平台 | Endpoint 特征 | HTTP 方法 | 格式 | 事件名字段 | 用户 ID 字段 | 时间戳字段 |
|------|--------------|-----------|------|-----------|------------|-----------|
| **火山/Rangers** | `*/sdk/app/batch` 或 `*/v2/event/list` | POST | JSON Array | `events[].event` | `user.user_unique_id` | `events[].local_time_ms`（毫秒） |
| **神策** | `*/sa` 或 `*/sa.gif` | POST/GET | Base64(Gzip(JSON)) | `event` | `distinct_id` | `time`（毫秒） |
| **百度统计** | `hm.baidu.com/hm.gif` | GET | Query String | `et`（类型码）| `si`（站点ID） | `lt`（秒） |
| **Google Analytics 4** | `google-analytics.com/g/collect` | POST | Query String | `en` | `cid` | - |
| **GA4 Measurement Protocol** | `google-analytics.com/mp/collect` | POST | JSON | `events[].name` | `client_id` | `timestamp_micros`（微秒） |
| **Mixpanel** | `api.mixpanel.com/track` | POST | JSON Array | `event` | `properties.distinct_id` | `properties.time`（秒） |
| **友盟** | `alog.umeng.com/app_logs` | POST | JSON | `body.events[].tag` | `header.device_id` | `body.events[].ts`（毫秒） |
| **Amplitude** | `api2.amplitude.com/2/httpapi` | POST | JSON | `events[].event_type` | `events[].user_id` | `events[].time`（毫秒） |

---

## 对 Event Radar 扩展的建议

当前扩展使用 `url.includes("list")` 匹配请求，主要命中火山引擎的 `/v2/event/list` 路径。

建议扩展为多平台规则匹配：

```javascript
const ANALYTICS_RULES = [
  // 火山引擎 / Rangers / Tea SDK
  { name: 'Rangers/Tea', match: url => /\/sdk\/app\/batch|\/v2\/event\/list/.test(url), method: 'POST' },
  // 神策数据
  { name: 'Sensors', match: url => /sensorsdata\.cn\/(sa|sa\.gif)/.test(url), method: 'POST' },
  // 百度统计
  { name: 'Baidu', match: url => /hm\.baidu\.com\/hm\.gif/.test(url), method: 'GET' },
  // Google Analytics 4
  { name: 'GA4', match: url => /google-analytics\.com\/(g\/collect|mp\/collect)/.test(url), method: 'POST' },
  // Mixpanel
  { name: 'Mixpanel', match: url => /api\.mixpanel\.com\/(track|import)/.test(url), method: 'POST' },
  // 友盟
  { name: 'Umeng', match: url => /alog\.umeng\.com\/app_logs/.test(url), method: 'POST' },
  // Amplitude
  { name: 'Amplitude', match: url => /api2?\.amplitude\.com\/(2\/httpapi|httpapi)/.test(url), method: 'POST' },
];
```

---

## 参考资料

- [火山引擎 DataFinder HTTP API](https://www.volcengine.com/docs/84129/1261781)
- [bytedance/RangersAppLog GitHub](https://github.com/bytedance/RangersAppLog)
- [神策数据接入 API 文档](https://sensorsdata.cn/2.0/manual/data_import_api.html)
- [sensorsdata/sa-sdk-javascript GitHub](https://github.com/sensorsdata/sa-sdk-javascript)
- [Google Analytics 4 Measurement Protocol Reference](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference)
- [GA4 g/collect 参数解析](https://googleanalytics4.co/implementation/how-google-analytics-4-collects-data-for-web/)
- [Mixpanel Track Events API Reference](https://developer.mixpanel.com/reference/track-event)
- [友盟开发者中心](https://developer.umeng.com/docs)
- [Amplitude HTTP API v2](https://www.docs.developers.amplitude.com/analytics/apis/http-v2-api/)
