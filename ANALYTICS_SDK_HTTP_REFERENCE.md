# Analytics SDK HTTP Request Reference

This document catalogues the network request characteristics of major analytics/event-tracking SDKs.
It is intended to guide URL pattern matching, payload parsing, and platform identification in the
Tea Event Radar Chrome extension.

---

## Table of Contents

1. [火山引擎 / Volcano Engine (ByteDance DataFinder / RangersAppLog)](#1-火山引擎--volcano-engine-bytedance-datafinder--rangersapplog)
2. [神策数据 / Sensors Analytics](#2-神策数据--sensors-analytics)
3. [百度统计 / Baidu Tongji](#3-百度统计--baidu-tongji)
4. [Google Analytics 4 (GA4) — Measurement Protocol](#4-google-analytics-4-ga4--measurement-protocol)
5. [Google Analytics — Universal Analytics (UA) — Deprecated](#5-google-analytics--universal-analytics-ua--deprecated)
6. [GA4 — Browser gtag.js Collect Requests](#6-ga4--browser-gtagjs-collect-requests)
7. [腾讯移动分析 / Tencent MTA](#7-腾讯移动分析--tencent-mta)
8. [友盟 / Umeng (U-App)](#8-友盟--umeng-u-app)
9. [Mixpanel](#9-mixpanel)
10. [Amplitude](#10-amplitude)
11. [Quick-Reference: URL Pattern Matching Table](#11-quick-reference-url-pattern-matching-table)

---

## 1. 火山引擎 / Volcano Engine (ByteDance DataFinder / RangersAppLog)

### Background

ByteDance's analytics stack is built on two layers:
- **RangersAppLog SDK** (client-side, also called AppLog / TEA SDK) — collects events from apps and
  sends them to an AppLog ingestion service.
- **DataFinder (增长分析)** — the analytics platform that consumes those events via Kafka and stores
  them in a data warehouse.

The SDK is open-sourced at [github.com/bytedance/RangersAppLog](https://github.com/bytedance/RangersAppLog).

### Endpoint URLs

| Environment | Domain | Path | Notes |
|---|---|---|---|
| China (SaaS non-cloud-native) | `mcs.volceapplog.com` | `/v3/app/batch` | Current CN endpoint |
| International (non-CN) | `log.byteoversea.com` | `/v3/app/batch` | Used by TikTok, CapCut, etc. |
| China (older / legacy) | `mcs.zijieapi.com` | `/v3/app/batch` | Found in older Douyin/Toutiao |
| Volcano Engine SaaS (cloud-native) | `gator.volces.com` | `/v2/event/json` | Current SaaS offering |
| Device/session registration | same domain as above | `/v3/user/ssid` | Fetches Static Session ID |
| Private/self-hosted | customer-defined | customer-defined | For on-premises deployments |

### HTTP Method

`POST`

### Headers

| Header | Value / Example |
|---|---|
| `Content-Type` | `application/json` |
| `X-MCS-AppKey` | `12345678key` (app key, used in some deployment modes) |

### Request Body Format

JSON. The body has three top-level keys: `user`, `header`, and `events`.

```json
{
  "user": {
    "user_unique_id": "user_abc123",
    "device_id": "7654321987654321",
    "ssid": "obtained-from-v3/user/ssid"
  },
  "header": {
    "app_id": 159486,
    "app_name": "news_article",
    "app_version": "9.6.0",
    "os": "Android",
    "os_version": "12",
    "device_model": "Pixel 6",
    "language": "zh",
    "timezone": "Asia/Shanghai",
    "resolution": "1080*2340",
    "channel": "official"
  },
  "events": [
    {
      "event": "play_video",
      "params": "{\"video_id\":\"v123\",\"duration\":120}",
      "local_time_ms": 1489573628001
    }
  ]
}
```

### Key Parameter Names

| Concept | Field Name | Location |
|---|---|---|
| App identifier | `app_id` (int) | `header` object |
| App name | `app_name` | `header` object |
| Event name | `event` | each object in `events` array |
| Event properties | `params` | JSON-string inside each event object |
| User ID (login) | `user_unique_id` | `user` object |
| Device ID | `device_id` | `user` object |
| Session ID | `ssid` | `user` object |
| Timestamp (ms) | `local_time_ms` | each event object |

### Batching

- Default: events are buffered for up to 30 ms OR until 10 events accumulate, then sent as one batch.
- The `max_report` config param overrides the 10-event threshold.
- Each request's `events` array may contain multiple event objects.

### Notes

- The `params` field inside each event is a **JSON-encoded string** (not an inline object), so it
  must be parsed twice.
- Special platform events (e.g., item metadata) use reserved event names prefixed with `__`
  (e.g., `__item_set`).
- The `/v3/user/ssid` endpoint is called on first launch or after reinstall to obtain an SSID that
  persists across sessions.

---

## 2. 神策数据 / Sensors Analytics

### Background

Sensors Data (神策数据) is a self-hosted or SaaS analytics platform popular in China.
The data ingestion endpoint (称为"数据接收服务") is configurable per deployment.
The official decode tool: [https://www.sensorsdata.cn/tools/decode.html](https://www.sensorsdata.cn/tools/decode.html)

### Endpoint URL Pattern

The receiving address is configured by each customer and takes the form:

```
https://<customer-cluster>/sa?project=<project_name>&token=<token>
```

or simply:

```
https://<customer-cluster>/sa
```

For SaaS (cloud) deployments the domain is typically `*.datasink.sensorsdata.cn`, e.g.:
```
https://test-syg.datasink.sensorsdata.cn/sa?token=xxxxx&project=xxxxxx
```

The pixel-style endpoint used by the **Web/JS SDK** appends `sa.gif`:
```
https://<server_url>/sa.gif?data=<encoded_payload>
```

### HTTP Method

- **Web/JS SDK (browser)**: `GET` (pixel request to `sa.gif`) — payload in query string
- **Mobile/App SDK and Server SDK**: `POST` — payload in request body
- `send_type` can be `beacon` (using the Beacon API) or `ajax` depending on SDK config

### Payload Format & Encoding

#### Web/JS SDK (GET request to `sa.gif`)

The raw JSON event(s) are encoded as follows before being placed in the `data=` query parameter:

```
JSON string → Base64 encode → URL encode → appended as data=<value>
```

To decode a captured `data=` value:
1. URL-decode the value
2. Base64-decode the result
3. Parse the resulting JSON

#### Mobile/App SDK (POST request)

The raw JSON event array is encoded as follows before being placed in the `data_list=` POST body parameter:

```
JSON array string → Gzip compress → Base64 encode → URL encode → POST body as data_list=<value>
```

The `Content-Type` is `application/x-www-form-urlencoded`.

To decode a captured `data_list=` value:
1. URL-decode the value
2. Base64-decode the result
3. Gzip-decompress the result
4. Parse the resulting JSON array

### Event JSON Structure

```json
{
  "distinct_id": "2b0a6f51a3cd6775",
  "time": 1434556935000,
  "type": "track",
  "event": "ViewProduct",
  "project": "my_project",
  "ip": "1.2.3.4",
  "properties": {
    "$app_version": "1.3",
    "$os": "iOS",
    "$os_version": "16.0",
    "$wifi": true,
    "$screen_width": 390,
    "$screen_height": 844,
    "$is_login_id": false,
    "product_id": 12345,
    "product_name": "some product"
  }
}
```

Batch sends wrap multiple such objects in a JSON array.

### Key Parameter Names

| Concept | Field Name | Notes |
|---|---|---|
| Event name | `event` | String; alphanumeric + `_` |
| Event type | `type` | `"track"`, `"profile_set"`, `"profile_set_once"`, etc. |
| User identifier | `distinct_id` | Anonymous (cookie/device) or login ID |
| Login flag | `$is_login_id` (in `properties`) | Boolean |
| Timestamp | `time` | Unix epoch in milliseconds |
| Project | `project` | Project name in SA system |
| Custom properties | `properties` | Object; preset props prefixed with `$` |
| SDK lib info | `lib` | Auto-included; contains SDK name, version |

### Batching

- Batch size: up to **50 events** per request (recommended).
- Server-side `BatchConsumer`: sends when buffer reaches configured count (default ~100).
- Beacon mode may send a single event per request.

### OpenAPI (Management / Reporting)

```
POST https://<cluster>/api/v3/portal/v2/management/behavior/list
```
Authentication required (token-based). Used for querying stored data, not for ingestion.

---

## 3. 百度统计 / Baidu Tongji

### Background

Baidu Analytics (百度统计) is a web-only analytics service, similar in model to Google Analytics UA.
It uses a single-pixel GIF approach for data collection from browsers.

### Endpoint URLs

| Purpose | URL |
|---|---|
| JS SDK loader | `https://hm.baidu.com/hm.js?<32-char-site-id>` |
| Event/pageview collection (pixel) | `https://hm.baidu.com/hm.gif?<params>` |
| Data export API | `https://api.baidu.com/json/tongji/v1/ReportService/getData` |

### HTTP Method

`GET` (the `hm.gif` pixel request is a standard image GET)

### Payload Format

All event data is sent as **URL query string parameters** appended to `hm.gif`.

Example captured request:
```
https://hm.baidu.com/hm.gif?cc=1&ck=1&cl=24-bit&ds=1280x800&ep=6648,3211&et=3
  &fl=17.0&ja=1&ln=zh-CN&lo=0&lt=1426499689&nv=0&rnd=798622641
  &si=e23800c454aa573c0ccb16b52665ac26&st=4&su=http%3A%2F%2Fexample.com%2Fask
  &v=1.0.75&lv=3&u=http%3A%2F%2Fexample.com%2F
```

### Key Parameter Names

| Parameter | Description |
|---|---|
| `si` | **Site ID** (32-char hex token; acts as app/property ID) |
| `u` | Current page URL |
| `su` | Previous page URL (`document.referrer`) |
| `lt` | Unix timestamp |
| `rnd` | 10-digit random number (deduplication) |
| `ln` | User language |
| `ds` | Screen size (e.g., `"1280x800"`) |
| `cl` | Color depth (e.g., `"24-bit"`) |
| `fl` | Flash version |
| `ja` | Java support: `1` or `0` |
| `ck` | Cookie support: `1` or `0` |
| `ep` | Page dwell time |
| `et` | Time event type |
| `v` | SDK/script version |
| `lv` | Unknown; typically `3` |
| `cc`, `cf`, `ci`, `cm`, `cp`, `cw` | Campaign/UTM-like parameters |

### Visitor Identification

Visitor ID is stored in a cookie named **`HMACCOUNT`** (expires 2038). There is no explicit
`client_id` or `user_id` parameter in the GIF request; identity is inferred from this cookie
server-side.

### Notes

- Baidu Tongji is a web-only service. There is no mobile SDK.
- No custom event concept; it is purely session/pageview oriented.
- No `POST` requests are used for standard tracking.
- The `hm.gif` response is always a 1x1 transparent GIF with HTTP 200.

---

## 4. Google Analytics 4 (GA4) — Measurement Protocol

### Background

GA4 Measurement Protocol is a **server-to-server** HTTP API. It complements (but does not replace)
the browser gtag.js and Firebase SDKs. It requires a secret key in addition to the measurement ID.

### Endpoint URL

```
POST https://www.google-analytics.com/mp/collect
```

Query parameters required in the URL:
```
?measurement_id=G-XXXXXXXXXX&api_secret=<secret>
```

Debug/validation endpoint:
```
POST https://www.google-analytics.com/debug/mp/collect
```

### HTTP Method

`POST`

### Headers

```
Content-Type: application/json
```

### Request Body Format

JSON body with the following top-level fields:

```json
{
  "client_id": "1234567890.1234567890",
  "user_id": "optional-login-id",
  "timestamp_micros": 1396381378123456,
  "non_personalized_ads": false,
  "events": [
    {
      "name": "purchase",
      "params": {
        "session_id": "SESSION_ID",
        "engagement_time_msec": 100,
        "currency": "USD",
        "value": 29.99
      }
    }
  ]
}
```

### Key Parameter Names

| Concept | Field Name | Location |
|---|---|---|
| Property/Stream ID | `measurement_id` | URL query param |
| API secret | `api_secret` | URL query param |
| Browser client ID | `client_id` | Top-level body field |
| Login user ID | `user_id` | Top-level body field (optional) |
| Timestamp | `timestamp_micros` | Top-level body field (microseconds) |
| Event name | `name` | Inside each object in `events` array |
| Event parameters | `params` | Object inside each event object |
| Session identifier | `session_id` | Inside `params` |
| Engagement time | `engagement_time_msec` | Inside `params` |

### Limits

- Up to **25 events** per request
- Request body must be **< 130 KB**
- Timestamps must be within the **last 72 hours**
- Max **100 batches/second**, **1,000 events/second**

---

## 5. Google Analytics — Universal Analytics (UA) — Deprecated

> **Note:** Standard UA properties stopped processing data on July 1, 2023. UA 360 stopped July 1, 2024.
> Documented here for reference when analyzing legacy traffic.

### Endpoint URL

```
POST https://www.google-analytics.com/collect
GET  https://www.google-analytics.com/collect?<params>
```

Debug endpoint: `https://www.google-analytics.com/debug/collect`

### HTTP Method

`GET` or `POST` (POST preferred; payload in URI-encoded body)

### Payload Format

URL-encoded key-value pairs. POST body or GET query string, max 8 KB (POST) / 8000 bytes (GET).

Example event hit:
```
v=1&tid=UA-XXXXX-Y&cid=555&t=event&ec=Video&ea=play&el=HomePage&ev=1
```

### Key Parameter Names

| Parameter | Description |
|---|---|
| `v` | Protocol version — always `1` for UA |
| `tid` | Tracking ID (e.g., `UA-123456-1`) |
| `cid` | Client ID (anonymous visitor UUID) |
| `uid` | User ID (authenticated user, optional) |
| `t` | Hit type: `pageview`, `event`, `transaction`, `timing`, `screenview`, `social`, `exception` |
| `ec` | Event category (required for `t=event`) |
| `ea` | Event action (required for `t=event`) |
| `el` | Event label (optional) |
| `ev` | Event value (integer, optional) |
| `dp` | Document path (for pageview) |
| `dt` | Document title (for pageview) |
| `qt` | Queue time (ms since event occurred, for offline hits) |
| `z` | Cache buster (random number) |

---

## 6. GA4 — Browser gtag.js Collect Requests

### Background

When GA4 is implemented via `gtag.js` in a browser, the SDK sends GET requests directly
to Google's collection endpoint. These differ from the Measurement Protocol (which is server-to-server).

### Endpoint URL

```
GET https://www.google-analytics.com/g/collect?<params>
```

### HTTP Method

`GET` (standard browser beacon-style request)

### Key URL Parameters

| Parameter | Example Value | Description |
|---|---|---|
| `v` | `2` | Protocol version; `2` identifies GA4 (vs. `1` for UA) |
| `tid` | `G-W82H8S53ST` | GA4 Measurement ID |
| `cid` | `1489945657.1691089601` | Client ID (from `_ga` cookie) |
| `_p` | `102644968` | Random page/hit ID for deduplication |
| `en` | `page_view` | Event name |
| `gtm` | `45je4620` | GTM container version info |
| `ul` | `en-us` | User language |
| `sr` | `1920x1080` | Screen resolution |
| `ep.<key>` | `ep.TimeOfDay=Morning` | Inline event parameters (key-value pairs) |
| `_et` | `13` | Engagement time (ms) |

Example full URL:
```
https://www.google-analytics.com/g/collect?v=2&tid=G-XXXXXXXXXX&_p=102644968
  &cid=1489945657.1691089601&ul=en-us&sr=1920x1080&en=purchase&ep.currency=USD
```

### Visitor Cookie

The client ID is stored in the `_ga` cookie. Cookie format: `GA1.2.<cid_part1>.<cid_part2>`.
The client ID is the last two dot-separated segments.

---

## 7. 腾讯移动分析 / Tencent MTA

> **Note:** MTA mobile App analytics shut down on **March 31, 2021**.
> H5 and Mini Program analytics shut down on **June 31, 2021**.
> Documented here for reference on legacy traffic.

### Endpoint URLs

| Purpose | URL |
|---|---|
| JS SDK loader | `http://pingjs.qq.com/h5/stats.js?v2.0.4` |
| Ad stats SDK | `http://pingjs.qq.com/h5/ad_stats.js?v1` |
| Channel stats SDK | `http://pingjs.qq.com/mta/channel_stats.js?v1` |
| Ad impression tracking | `http://sl.mta.qq.com/monitor/<id>?action=impression` |
| Page view / event reporting | `pgv.qq.com` (internal; not publicly documented) |

### HTTP Method

JS SDK: `GET` (pixel-style). The exact internal reporting endpoint used by the iOS/Android SDK
was not publicly documented and requires traffic capture to confirm.

### Key SDK Parameters

| Parameter | Description |
|---|---|
| `sid` | App ID (统计用的 appid) — primary identifier for H5 |
| `cid` | Custom event stats ID — required when custom events are enabled |
| `app_key` | App Key — used for native iOS/Android and channel tracking |
| `autoReport` | `1` = auto-report on init; `0` = manual |
| `senseHash` | Include URL hash in tracking: `0`/`1` |
| `senseQuery` | Include URL query string in tracking: `0`/`1` |
| `performanceMonitor` | Enable performance monitoring: `0`/`1` |

### Event Reporting API (JS)

```javascript
// Page view
MtaH5.pgv();

// Custom event
MtaH5.clickStat("event_id", { "param_key": "param_value" });

// Mini Program
mta.Event.stat("event_id", { "param_key": "param_value" });
```

Event IDs must be pre-registered in the MTA backend console.

### Notes

- The domain `pingjs.qq.com` is flagged in many ad/tracker block lists.
- No publicly documented JSON payload format for the raw HTTP requests.

---

## 8. 友盟 / Umeng (U-App)

### Background

Umeng (友盟+) is owned by Alibaba. It is one of the most widely used analytics SDKs for
Chinese Android and iOS apps. The data collection endpoint is `alog.umeng.com`.

### Endpoint URL

```
POST http://alog.umeng.com/app_logs
```

(HTTPS is also used in newer SDK versions)

Related domains:
- `alog.umeng.com` — primary analytics log endpoint
- `ulogs.umeng.com` — secondary/overflow log endpoint
- `errlog.umeng.com` — error/crash log endpoint
- `msgapi.umeng.com` — push notification API (separate service)

### HTTP Method

`POST`

### Headers

| Header | Value / Example |
|---|---|
| `X-Umeng-Sdk` | OS version, app version, device model (e.g., `Android/6.1.1`) |
| `X-Umeng-Utdid` | Alibaba UTDID (unique terminal device ID, shared across Alibaba SDKs) |
| `Content-Type` | `application/json` (or `application/octet-stream` when encrypted) |

### Request Body Format

JSON with two top-level keys: `header` and `body`.

```json
{
  "header": {
    "appkey": "596087883eae2574b10013a3",
    "device_id": "000000000000000",
    "app_version": "1.0",
    "sdk_version": "6.1.1",
    "os": "Android",
    "package_name": "com.example.app",
    "device_model": "Pixel 6",
    "device_name": "generic_x86",
    "device_brand": "Google",
    "device_manufacturer": "Google",
    "device_board": "redfin",
    "resolution": "1080*2340",
    "carrier": "T-Mobile",
    "access": "WiFi",
    "access_subtype": "",
    "timezone": 8,
    "country": "CN",
    "cpu": "4",
    "vertical_type": 0,
    "version_code": 100,
    "app_signature": "BE:B9:05:B4:...",
    "req_time": 0,
    "id_tracking": "<base64-encoded IMEI/Android ID bundle>"
  },
  "body": {
    "activate_msg": {
      "ts": 1499889460391
    }
  }
}
```

### Key Parameter Names

| Concept | Field Name | Location |
|---|---|---|
| App identifier | `appkey` | `header` object |
| Device identifier | `device_id` | `header` object |
| Timestamp | `ts` | Inside event objects in `body` |
| OS name | `os` | `header` object |
| App version | `app_version` | `header` object |
| SDK version | `sdk_version` | `header` object |
| Package name | `package_name` | `header` object |
| Device model | `device_model` | `header` object |
| Screen resolution | `resolution` | `header` object |
| Network type | `access` | `header` object |
| Carrier | `carrier` | `header` object |
| Timezone offset | `timezone` | `header` object (integer) |
| Encrypted device IDs | `id_tracking` | `header` object (base64 bundle) |

### Notes

- The `id_tracking` field is a Base64-encoded bundle that typically contains IMEI, Android ID,
  OAID, and other device fingerprints. Its internal format is not publicly documented.
- In newer versions, the body may be AES-encrypted and the `Content-Type` changes to
  `application/octet-stream`.
- Custom event IDs must be pre-registered in the Umeng dashboard.
- The `appkey` is the primary app identifier (analogous to `app_id` in other SDKs).

### Report Policy (Batching)

The `reportPolicy` setting on init controls when data is uploaded:
- `BATCH` — upload on app start
- `REALTIME` — upload immediately after each event
- `SENDINTERVAL` — upload on a time interval
- `SEND_INTERVAL_SESSION` — upload on session start

---

## 9. Mixpanel

### Background

Mixpanel is a US-based product analytics platform. It supports both a JavaScript browser SDK
and server-side SDKs/direct HTTP API calls.

### Endpoint URLs

| Purpose | URL |
|---|---|
| Real-time event ingestion | `https://api.mixpanel.com/track` |
| Historical event import (> 5 days old) | `https://api.mixpanel.com/import` |
| User profile updates | `https://api.mixpanel.com/engage` |

### HTTP Method

`POST` (preferred for all server-side and SDK use)

Legacy browser SDK also supports `GET` with a `data=` parameter containing Base64-encoded JSON.

### Headers

```
Content-Type: application/json
```

For `/import` endpoint (requires project secret as HTTP Basic Auth username):
```
Authorization: Basic <base64(project_secret:)>
```

### Request Body Format

JSON array of event objects (for both `/track` and `/import`):

```json
[
  {
    "event": "Sign Up",
    "properties": {
      "token": "YOUR_PROJECT_TOKEN",
      "distinct_id": "user_abc123",
      "time": 1698023982,
      "$insert_id": "uuid-per-event-for-deduplication",
      "$browser": "Chrome",
      "$os": "Windows",
      "plan": "premium",
      "signup_source": "homepage"
    }
  }
]
```

Note: The legacy GET format encodes the above as:
```
GET https://api.mixpanel.com/track?data=<base64_encoded_json>
```

### Key Parameter Names

| Concept | Field Name | Location |
|---|---|---|
| Event name | `event` | Top-level of each event object |
| Project identifier | `token` | Inside `properties` object |
| User identifier | `distinct_id` | Inside `properties` object |
| Timestamp | `time` | Inside `properties` (Unix epoch, seconds) |
| Deduplication ID | `$insert_id` | Inside `properties` |
| Super/global properties | (any key) | Inside `properties` |
| IP address | `$ip` | Inside `properties` (optional) |

### Limits and Batching

- `/track`: only processes events with timestamps **within the last 5 days**
- `/import`: for events older than 5 days; up to **2,000 events per request**
- `/import` requests can be gzip-compressed
- SDK queues events in memory and flushes periodically

### User Profiles (`/engage`)

```json
{
  "$token": "YOUR_PROJECT_TOKEN",
  "$distinct_id": "user_abc123",
  "$set": {
    "name": "Alice",
    "plan": "premium"
  }
}
```

---

## 10. Amplitude

### Background

Amplitude is a US-based product analytics platform. It provides both a JavaScript browser SDK
and a server-side HTTP API.

### Endpoint URLs

| Purpose | URL |
|---|---|
| Standard event ingestion | `https://api2.amplitude.com/2/httpapi` |
| Large-batch ingestion | `https://api2.amplitude.com/batch` |
| EU data residency (standard) | `https://api.eu.amplitude.com/2/httpapi` |
| EU data residency (batch) | `https://api.eu.amplitude.com/batch` |

### HTTP Method

`POST`

### Headers

```
Content-Type: application/json
Accept: */*
```

### Request Body Format

JSON object with `api_key` and `events` array:

```json
{
  "api_key": "YOUR_AMPLITUDE_API_KEY",
  "options": {
    "min_id_length": 5
  },
  "events": [
    {
      "user_id": "12345",
      "device_id": "C8F9E604-F01A-4BD9-95C6-8E5357DF265D",
      "event_type": "watch_tutorial",
      "time": 1396381378123,
      "event_properties": {
        "load_time": 0.84,
        "source": "notification"
      },
      "user_properties": {
        "age": 25,
        "gender": "female"
      },
      "app_version": "2.1.3",
      "platform": "iOS",
      "os_name": "iOS",
      "os_version": "16.0",
      "device_brand": "Apple",
      "device_manufacturer": "Apple",
      "device_model": "iPhone14,3",
      "carrier": "AT&T",
      "country": "United States",
      "region": "California",
      "city": "San Francisco",
      "language": "English",
      "ip": "$remote"
    }
  ]
}
```

### Key Parameter Names

| Concept | Field Name | Location |
|---|---|---|
| Project identifier | `api_key` | Top-level body field |
| Event name | `event_type` | Each event object |
| User ID (login) | `user_id` | Each event object |
| Device ID | `device_id` | Each event object |
| Timestamp | `time` | Each event object (milliseconds) |
| Event properties | `event_properties` | Each event object |
| User properties | `user_properties` | Each event object |
| App version | `app_version` | Each event object |
| Platform | `platform` | Each event object |
| OS name | `os_name` | Each event object |

### Limits and Batching

- Standard endpoint: max **10 events per batch** recommended; max **2,000 events per request**;
  max **1 MB per request**
- Rate limits: **100 batches/second**, **1,000 events/second**
- Browser SDK: flushes every **30 seconds** or configurable `flushQueueSize`/`flushIntervalMillis`
- For page-exit: use `sendBeacon` transport + call `amplitude.flush()`
- Batch endpoint (`/batch`): same thresholds but optimized for larger payloads

### Browser SDK Notes

- `device_id` and `user_id` must each be **at least 5 characters** (enforced by HTTP V2 API)
- User ID and device ID are stored in localStorage
- Events with IDs that are too short are silently dropped

---

## 11. Quick-Reference: URL Pattern Matching Table

This table summarizes the information most useful for matching URLs in the Tea Event Radar extension.

| Platform | URL Pattern to Match | Method | Payload Key to Parse |
|---|---|---|---|
| Volcano Engine / ByteDance (current) | `*.volces.com/v2/event/json` | POST | `events[]` array |
| Volcano Engine / ByteDance (legacy CN) | `mcs.zijieapi.com/v3/app/batch` | POST | `events[]` array |
| Volcano Engine (international) | `log.byteoversea.com/v3/app/batch` | POST | `events[]` array |
| Volcano Engine (alt CN) | `mcs.volceapplog.com/v3/app/batch` | POST | `events[]` array |
| Sensors Analytics (Web SDK) | `*/sa.gif?data=*` | GET | `data=` (base64 JSON) |
| Sensors Analytics (App/Server SDK) | `*/sa?*` | POST | `data_list=` (gzip+base64 JSON) |
| Sensors Analytics (OpenAPI) | `*/api/v3/portal/*` | POST | JSON body |
| Baidu Tongji (collection) | `hm.baidu.com/hm.gif` | GET | Query params: `si`, `u`, `lt` |
| Baidu Tongji (Data API) | `api.baidu.com/json/tongji/v1/*` | POST | JSON body |
| GA4 Measurement Protocol | `www.google-analytics.com/mp/collect` | POST | `events[]` in JSON body |
| GA4 Browser (gtag.js) | `www.google-analytics.com/g/collect` | GET | Query params: `en`, `cid`, `tid` |
| Universal Analytics (legacy) | `www.google-analytics.com/collect` | GET/POST | Query params: `t`, `cid`, `tid` |
| Tencent MTA (JS SDK loader) | `pingjs.qq.com/h5/stats.js` | GET | Script tag `sid` / `app_key` attrs |
| Tencent MTA (impression) | `sl.mta.qq.com/monitor/*` | GET | Query param `action` |
| Umeng (primary) | `alog.umeng.com/app_logs` | POST | JSON body: `header.appkey`, `body.*` |
| Umeng (secondary) | `ulogs.umeng.com/*` | POST | JSON body: same structure |
| Umeng (errors) | `errlog.umeng.com/*` | POST | JSON body |
| Mixpanel (real-time) | `api.mixpanel.com/track` | POST | JSON array: `event`, `properties.distinct_id` |
| Mixpanel (import) | `api.mixpanel.com/import` | POST | JSON array: same structure |
| Mixpanel (profiles) | `api.mixpanel.com/engage` | POST | JSON: `$distinct_id`, `$set` |
| Amplitude (standard) | `api2.amplitude.com/2/httpapi` | POST | `events[].event_type`, `api_key` |
| Amplitude (batch) | `api2.amplitude.com/batch` | POST | `events[].event_type`, `api_key` |
| Amplitude (EU) | `api.eu.amplitude.com/2/httpapi` | POST | same |

---

## Sources

- [Volcengine DataFinder HTTP API docs](https://www.volcengine.com/docs/84129/1261781)
- [ByteDance RangersAppLog GitHub](https://github.com/bytedance/RangersAppLog)
- [Sensors Analytics Web SDK integration docs](https://docs.sensorsdata.com/sa/docs/tech_sdk_client_web_use)
- [Sensors Analytics data format reference](https://docs.sensorsdata.com/sa/docs/tech_knowledge_layout/v0300)
- [Sensors Analytics OpenAPI overview](https://docs.sensorsdata.com/sa/docs/about_open_api/v0300)
- [Sensors Analytics decode tool](https://www.sensorsdata.cn/tools/decode.html)
- [Baidu Tongji JS API](https://tongji.baidu.com/holmes/Analytics/)
- [GA4 Measurement Protocol reference](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference)
- [GA4 Measurement Protocol sending events](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events)
- [Universal Analytics Measurement Protocol reference](https://developers.google.com/analytics/devguides/collection/protocol/v1/reference)
- [Tencent MTA H5 docs](https://mta.qq.com/docs/h5_advance_access.html)
- [Umeng SDK Android integration](https://dev.umeng.com/analytics/android-doc/integration)
- [Umeng alog.umeng.com traffic analysis (ANY.RUN)](https://any.run/report/0728f90505bbb9f1e796836afa0d880b60c0208859cac4b3631abc40c4d08a06/db603a1f-0b72-469d-9149-27d984199b92/)
- [Mixpanel track events docs](https://docs.mixpanel.com/docs/quickstart/capture-events/track-events)
- [Mixpanel JavaScript SDK docs](https://docs.mixpanel.com/docs/tracking-methods/sdks/javascript)
- [Amplitude HTTP V2 API](https://amplitude.com/docs/apis/analytics/http-v2)
- [Amplitude HTTP API quickstart](https://amplitude.com/docs/apis/analytics/http-api-quickstart)
