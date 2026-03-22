# Tea Event Radar 埋点解析增强方案说明

> Status: Implemented
> Source of truth: 当前仓库代码实现
> Last synced: 2026-03-20
> Freshness: 🟢 FRESH
> Scope: `神策埋点解析修复` + `Amplitude解析增强` + `Panel统一渲染` + `平台过滤默认策略` + `各平台端点补全`

> Note: 本文档记录 2026-03-20 的阶段性增强里程碑，文中提到的“17 个平台”仅代表当时范围。当前完整实现请以 `docs/product-technical-spec.md` 为准。

---

## 1. 文档目的

本文档记录 Tea Event Radar 在多平台埋点解析方面的增强修复，以币安（Binance）页面的神策埋点和 Amplitude-like 埋点为典型案例，涵盖问题根因分析、修复方案、数据流变化和配置变更。

---

## 2. 修改总览

| 修改点 | 涉及文件 | 核心变化 |
|-------|---------|---------|
| 神策 Matcher 增强 | `platform-adapters.js` | 新增 `sa.gif`、`batch` 路径识别，`data=` 不再强制 `gzip=` |
| 神策 Parser 修复 | `platform-adapters.js` | 修复 form body base64 解码被跳过的 bug |
| 神策 Base64 解码增强 | `analytics-core.js` | URL-decode 预处理 + base64 padding 修复 |
| 神策 Gzip 异步解码 | `service-worker.js` | 新增 `trySensorsAsyncDecode` 异步解码管线 |
| Amplitude Matcher 收紧 | `platform-adapters.js` | `/batch` 子串匹配降分，新增 `type+ts+deviceId` 信号 |
| Amplitude Parser 增强 | `platform-adapters.js` | fallback `type`/`ts`，解析 `data` JSON 字符串 |
| Panel 统一渲染 | `panel.js` | 非 DataRangers 平台调用 `parseRequest()` 解析 |
| 平台过滤默认策略 | `panel.js`, `panel.html` | 默认仅显示已识别平台，新增"未知平台"选项 |
| 各平台端点补全 | `platform-catalog.js` | 17 个平台的 Name 列特征端点补齐 |

---

## 3. 问题一：神策埋点无法识别和解析

### 3.1 典型案例

币安页面神策埋点请求：

```
POST https://api.saasexch.com/bapi/fe/usd/sa.gif?project=binance

Body: data=eyJp...<base64>&ext=crc%3D450874232
```

### 3.2 根因分析

**Matcher 匹配失败（总分 0.15 < 0.4 阈值）：**

| 检查项 | 期望 | 实际 | 得分 |
|-------|------|------|------|
| Host 含 `sensorsdata` | `api.saasexch.com` | 不含 | +0 |
| Path `/sa` / `/sa?` / `/sa/` | `/bapi/fe/usd/sa.gif` | 均不匹配 | +0 |
| Query `project=` | `binance` | 匹配 | +0.15 |
| Body `data=` + `gzip=` | `data=eyJp...` | 无 `gzip=` | +0 |

**Parser 解码失败：**

1. `parseBody()` 将 body 解析为 form data: `{ data: "eyJp...", ext: "crc=..." }`
2. Parser 将此 form object 直接放入 `dataItems = [{ data: "...", ext: "..." }]`
3. 由于 `dataItems.length > 0`，base64 解码分支被跳过
4. `item.event` / `item.type` 均为 `undefined`，输出"未知事件"

### 3.3 修复方案

**Matcher 增强（修复后评分 0.85）：**

```
path:sa.gif      → +0.35  （新增 /sa\.gif\b 正则匹配）
query:project    → +0.15
body:data(base64)→ +0.20  （data= 不再强制 gzip=）
body:form(data)  → +0.15  （检测 form body 中 data key 为长 base64 字符串）
总计: 0.85 >> 0.4 阈值
```

**Parser 修复：**

优先检测 `bodyParsed` 是否为 sensors form（含 `data` / `data_list` key），若是则走 base64 解码路径，不再误当事件对象处理。

**代码位置**: `tea_event_radar/platform-adapters.js` sensorsAdapter.parser

```javascript
// Check if bodyParsed is form-encoded with data/data_list (sensors base64 payload)
var isSensorsForm = false;
if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' && !Array.isArray(ctx.bodyParsed)) {
  var encodedData = ctx.bodyParsed.data_list || ctx.bodyParsed.data || '';
  if (typeof encodedData === 'string' && encodedData.length > 20) {
    isSensorsForm = true;
    var decoded = Core.decodeSensorsPayload(encodedData);
    if (decoded && !decoded.__gzipped) {
      if (Array.isArray(decoded)) dataItems = decoded;
      else dataItems = [decoded];
    }
  }
}
```

### 3.4 新增路径识别

| 路径 | 含义 | 来源 |
|------|------|------|
| `sa.gif` | 神策 image pixel 模式（默认 send_type） | SDK 文档 2.3 节 |
| `batch` + `project=` | 神策 batch_send 模式 | 币安页面实际抓包 |

### 3.5 Base64 解码增强

**代码位置**: `tea_event_radar/analytics-core.js` decodeSensorsPayload

- 新增 URL-decode 预处理（神策 SDK 可能对 base64 再做 URL-encode）
- 新增 base64 padding 修复（补齐缺失的 `=`）

### 3.6 Gzip 异步解码

**代码位置**: `tea_event_radar/service-worker.js` trySensorsAsyncDecode

当同步解码检测到 gzip magic number（`0x1F 0x8B`）时，启动异步管线：

```
form body → 提取 data/data_list → base64 decode → DecompressionStream(gzip)
→ JSON parse → 替换 eventData.requestData → 刷新 Panel
```

---

## 4. 问题二：Amplitude-like 埋点显示"未知事件"

### 4.1 典型案例

币安页面自定义监控 SDK（Pika）请求：

```
POST https://api.saasexch.com/bapi/fe/pda/v1/submit/web/batch?project=cc1ljun9gpbp8ciciolg

Body:
{
  "deviceId": "1fbe5f52-a0a6-4d5f-bb2b-4c277d207c2b",
  "platformType": 3,
  "events": [{
    "type": "e2e-network-web",
    "ts": 1773995906338,
    "data": "{\"meta\":{...},\"event\":{...}}"
  }]
}
```

### 4.2 根因分析

**Matcher 误匹配（旧评分 0.45）：**

- Path `/bapi/fe/pda/v1/submit/web/batch` 子串匹配 `/batch` → +0.3
- Body `events[]` 数组存在 → +0.15

被错误匹配为 Amplitude，但数据格式不同：

| 字段 | 标准 Amplitude | 实际数据 |
|------|--------------|---------|
| 事件名 | `event_type` | `type` |
| 时间戳 | `time` | `ts` |
| 属性 | `event_properties` | `data`（JSON 字符串） |
| 设备 ID | 事件级 `device_id` | 顶层 `deviceId` |

Parser 只读 `evt.event_type`（undefined），输出"未知事件"。

### 4.3 修复方案

**Matcher 评分调整：**

| 信号 | 旧分值 | 新分值 | 说明 |
|------|--------|--------|------|
| `/batch` 子串匹配（无 host） | +0.30 | +0.15 | 降低泛匹配权重，防止误匹配 |
| `/batch` 精确匹配 | +0.30 | +0.30 | 保持不变 |
| `events[].event_type` 存在 | +0.15 | +0.20 | 标准格式加分 |
| `events[].type` + `events[].ts` | — | +0.15 | 新增 Amplitude-like 格式识别 |
| 顶层 `deviceId` / `device_id` | — | +0.10 | 新增设备标识信号 |

**Parser 增强：**

**代码位置**: `tea_event_radar/platform-adapters.js` amplitudeAdapter.parser

```javascript
// 事件名 fallback: event_type → type
eventName: evt.event_type || evt.type || '',

// 时间戳 fallback: time → ts
eventTime: Core.normalizeTimestamp(evt.time || evt.ts),

// 解析 data JSON 字符串为 properties
if (evt.data && typeof evt.data === 'string') {
  try { evtProps = JSON.parse(evt.data); } catch(e) {}
}

// 顶层 deviceId 作为 anonymousId
var topDeviceId = data.device_id || data.deviceId || '';
```

### 4.4 修复后解析结果

| 字段 | 解析结果 |
|------|---------|
| 事件名称 | `e2e-network-web` |
| 用户标识 | `1fbe5f52-a0a6-4d5f-bb2b-4c277d207c2b` |
| 事件时间 | `2026-03-20T08:38:26.338Z` |
| 参数 | `meta.platform`, `meta.pikaVersion`, `event.host`, `event.path` 等 |

---

## 5. Panel 统一渲染改造

### 5.1 问题

`createEventCard()` 硬编码 DataRangers 数据格式 `requestData[0].events[].event`，其他平台的事件始终显示"无事件详情"。

### 5.2 方案

**代码位置**: `tea_event_radar/panel.js` createEventCard

非 DataRangers 平台调用 `PlatformAdapters.parseRequest()` 获取 NormalizedEvent 数组：

```javascript
if (platformId !== 'unknown' && platformId !== 'datarangers' &&
    window.TeaRadar && window.TeaRadar.PlatformAdapters) {
  var normalized = window.TeaRadar.PlatformAdapters.parseRequest(platformId, {
    url: event.url,
    method: event.method,
    bodyRaw: event.requestData || '',
    headers: event.headers || [],
    contentType: ''
  });
  // ...
}
```

NormalizedEvent 统一格式：

| 字段 | 含义 | 渲染位置 |
|------|------|---------|
| `eventName` | 事件名称 | 卡片标题 + 详情"事件名称" |
| `distinctId` / `userId` / `anonymousId` | 用户标识 | 详情"用户标识" |
| `eventTime` | 事件时间 | 详情"事件时间" |
| `properties` | 事件参数 | 详情参数表格 |
| `rawEvent` | 原始事件对象 | 原始数据区（JSON fallback） |

DataRangers 保持兼容旧逻辑，并将 legacy events 转为相同的 NormalizedEvent 格式统一渲染。

---

## 6. 平台过滤默认策略

### 6.1 问题

所有捕获的请求（含大量无法识别的 unknown 事件）默认全部展示，干扰正常埋点观察。

### 6.2 方案

**代码位置**: `tea_event_radar/panel.js` initPlatformFilter, filterEvents

| 选项 | 值 | 过滤逻辑 |
|------|---|---------|
| 📡 已识别平台（默认） | `__known__` | `platformId !== 'unknown'` |
| 全部平台 | `''` | 不过滤 |
| 各平台（17 个） | `sensors` / `google` / ... | 精确匹配 `platformId` |
| 💭 未知平台 | `unknown` | `platformId === 'unknown'` |

默认选中"已识别平台"，用户可手动切换到"全部平台"或"未知平台"查看。

---

## 7. 各平台 Name 列端点补全

Chrome DevTools Network 面板 Name 列中各平台的特征端点名，补充到 `platform-catalog.js` 的 `paths` 数组中，确保 `shouldCapture` 预过滤能正确捕获。

| 平台 | 新增路径 |
|------|---------|
| 神策 | `sa.gif`, `batch` |
| GA4 | `debug/mp/collect` |
| GrowingIO | `s.gif`, `collect` |
| Mixpanel | `track`（无斜杠）, `decide` |
| Amplitude | 移除泛匹配 `/batch`、`/identify`（仅靠 host 捕获） |
| TikTok | `pixel/track`, `i18n/pixel/static/main.js` |
| Heap | `api/track`, `api/identify`, `api/add_user_properties` |
| Hotjar | `c/hotjar-`, `api/v2/client/sites` |
| Adobe | `ee-pre-prd/`, `interact` |

---

## 8. 数据流变化

### 8.1 修改前

```
网络请求 → shouldCapture(url) → matchPlatform() → 存储 eventData
→ Panel: JSON.parse(requestData) → 硬编码 DataRangers 格式渲染
```

### 8.2 修改后

```
网络请求 → shouldCapture(url) → matchPlatform() → 存储 eventData
                                                   ↓ (sensors + gzip)
                                              trySensorsAsyncDecode()
                                                   ↓ 解码成功
                                              替换 requestData + 刷新
→ Panel: platformId 分发
   ├── datarangers → 兼容旧逻辑 → 转 NormalizedEvent
   ├── sensors/google/... → PlatformAdapters.parseRequest() → NormalizedEvent
   └── unknown → "无事件详情"
→ 统一 NormalizedEvent 格式渲染（事件名 + 用户标识 + 时间 + 参数表格）
```

---

## 9. 相关 Commit

| Commit | 说明 |
|--------|------|
| `6af8127` | 神策/Amplitude 埋点解析增强 + 平台过滤默认隐藏未知事件 |
