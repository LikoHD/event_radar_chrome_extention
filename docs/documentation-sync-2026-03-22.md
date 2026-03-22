# 文档同步检查记录

> Checked on: 2026-03-22
> Scope: `docs/` 目录内文档同步与补充

---

## 1. 本次检查结论

本仓库的代码实现已经明显快于文档，主要落差集中在以下几类：

1. 平台覆盖数量已从早期 17 个扩展到当前 36 个，但部分文档仍按 17 个描述
2. 面板行为已升级为“默认自动开始捕获 + 平台默认过滤已识别平台 + 设置侧栏支持 Regex 规则”，旧文档未体现
3. Service Worker 现在会保存可疑二进制请求体的 `requestBodyBase64`，并对神策、知乎做异步二次解码，旧文档缺失
4. CSV 导出现在会优先走 `PlatformAdapters.parseRequest()` 的归一化结果，而不是只依赖旧格式
5. 版本号存在三个来源：`manifest 1.0.5`、`package.json 1.0.4`、`panel header 1.1`，文档此前没有明确约定口径

---

## 2. 本次已补充内容

### 已更新

| 文档 | 处理 |
|------|------|
| `docs/product-technical-spec.md` | 重写为当前实现总览，补齐 36 平台、页面上下文探测、过滤规则、base64 保留、异步解码、CSV 导出、构建流程 |
| `docs/README.md` | 新增文档索引，区分“当前真相 / 历史里程碑 / 研究参考” |

### 已加范围提示

| 文档 | 提示目的 |
|------|------|
| `docs/event-parsing-enhancement-spec.md` | 标记为 17 平台阶段性里程碑，不代表当前完整现状 |
| `docs/analytics-platform-tracking-spec.md` | 标记为 17 平台研究参考，不是当前适配器全量清单 |
| `docs/analytics-platform-tracking-reference.md` | 同上 |

---

## 3. 当前实现关键事实

### 3.1 平台与解析

- 当前已识别平台适配器：`36`
- 当前仍保留 `unknown` 视图用于排查漏识别
- `zhihu`、`bilibili`、`ctrip`、`amazon` 等平台属于“稳定字段恢复优先”，不是私有协议完整逆向

### 3.2 面板与交互

- 面板加载后自动发送 `startCapturing`
- 平台过滤默认值是 `__known__`
- 设置面板支持：
  - 过滤规则 `filterRules`
  - 白名单规则 `whitelistRules`
  - 常见噪音请求预设

### 3.3 请求体处理

- 文本 body：UTF-8 -> `decodeURIComponent` -> 原样回退
- 二进制 / gzip body：额外保留 `requestBodyBase64`
- 异步解码：
  - `sensors`：gzip 解压后回写 JSON
  - `zhihu`：gzip 解压 + protobuf walker，提取页面实体 hints

### 3.4 导出与存储

- CSV 导出优先使用平台适配器的归一化解析结果
- `chrome.storage.local` 当前用于：
  - `panelWidth`
  - `filterRules`
  - `whitelistRules`

---

## 4. 仍待关注但未在本次 docs 范围修改的内容

以下内容已确认与当前实现不完全一致，但不在这次“补充到 docs”范围内：

| 文件 | 当前问题 |
|------|------|
| `README.md` | 仍写“当前内置 17 个已识别平台适配器”，未覆盖设置侧栏、base64 保留、知乎解码、CSV 新逻辑 |
| `tea_event_radar/README.md` | 仍是早期“主要抓 list POST + 侧边栏展示”的旧描述 |
| `package.json` vs `manifest.json` vs `panel.html` | 版本号未统一 |

如果下一步要继续清理文档，优先级建议如下：

1. 同步根目录 `README.md`
2. 同步 `tea_event_radar/README.md`
3. 统一代码里的版本号展示口径

---

## 5. 推荐维护规则

后续再扩平台或补 parser 时，建议按这个顺序同步：

1. 先改 `platform-catalog.js` / `platform-adapters.js`
2. 再更新 `docs/product-technical-spec.md`
3. 如果只是阶段性改造，再补专项文档
4. 如果是公开研究类信息，再决定是否补 `analytics-platform-*`

这样可以避免“研究文档很全，但当前实现说明反而过期”的情况再次出现。
