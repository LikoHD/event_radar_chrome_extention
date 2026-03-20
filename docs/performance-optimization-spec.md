# Tea Event Radar 性能优化方案说明

> Status: Implemented
> Source of truth: 当前仓库代码实现
> Last synced: 2026-03-19
> Freshness: 🟢 FRESH
> Scope: `Service Worker 内存管理` + `消息防抖` + `UI 渲染批处理` + `搜索过滤竞态修复`

---

## 1. 文档目的

本文档记录 Tea Event Radar 扩展在性能方面的已实施优化，包括问题描述、根因分析、修复方案和配置参数。作为性能相关排障和后续优化的参考。

---

## 2. 优化策略总览

| 优化点 | 策略 | 阈值 | 预期收益 |
|-------|------|------|---------|
| 内存管理 | 循环缓冲，超限自动裁剪 | 最多 1000 条，清理阈值 1200 | 内存占用降低 70-80% |
| 消息推送 | 防抖批量推送 | 100ms | 消息频率降低 60-70% |
| UI 渲染 | DocumentFragment + 防抖 | 50ms，最多渲染 100 条 | 60fps 流畅渲染 |
| 搜索过滤 | 输入防抖 + 竞态消除 | 200ms | 过滤计算减少 50-60%，消除抖动 |
| 面板缩放 | requestAnimationFrame 节流 | 16ms (60fps) | 拖拽不卡顿 |
| 渲染队列 | pendingRenderEvents + rAF | — | 消除丢帧，事件不漏显 |

---

## 3. Service Worker 内存管理优化

### 3.1 问题

无限制的事件累积导致内存泄漏和浏览器崩溃。

### 3.2 方案

采用「惰性清理」策略：不在每次插入时裁剪，而是达到 1200 条时批量裁剪到 1000 条，减少数组操作频率。

**代码位置**: `tea_event_radar/service-worker.js`

```javascript
const MAX_EVENTS = 1000;
const CLEANUP_THRESHOLD = 1200;

function cleanupEventsIfNeeded() {
  if (capturedEvents.length >= CLEANUP_THRESHOLD) {
    capturedEvents = capturedEvents.slice(0, MAX_EVENTS);
  }
}
```

---

## 4. 消息传递防抖优化

### 4.1 问题

每次网络请求捕获都立即向 Panel 发送消息，高频场景（如页面批量上报）下造成消息风暴。

### 4.2 方案

Service Worker 端 100ms 防抖，将短时间内的多次事件合并为一次推送。

**代码位置**: `tea_event_radar/service-worker.js`

```javascript
const UPDATE_DEBOUNCE_TIME = 100;

function debouncedUpdatePanel() {
  if (updateTimeout) {
    clearTimeout(updateTimeout);
  }
  pendingUpdates = true;
  updateTimeout = setTimeout(() => {
    if (pendingUpdates) {
      updatePanel();
      pendingUpdates = false;
    }
  }, UPDATE_DEBOUNCE_TIME);
}
```

---

## 5. UI 渲染性能优化

### 5.1 问题

频繁的 DOM 操作和大量事件渲染导致界面卡顿。

### 5.2 方案

- 使用 `DocumentFragment` 避免多次 DOM reflow
- 限制可见事件数量为 100 条，超出部分显示截断提示
- 渲染函数本身带 50ms 防抖

**代码位置**: `tea_event_radar/panel.js`

```javascript
const RENDER_DEBOUNCE_TIME = 50;
const MAX_VISIBLE_EVENTS = 100;

function renderEvents(events) {
  if (renderTimeout) {
    clearTimeout(renderTimeout);
  }
  renderTimeout = setTimeout(() => {
    doRenderEvents(events);
  }, RENDER_DEBOUNCE_TIME);
}
```

---

## 6. 搜索过滤竞态修复

### 6.1 问题

搜索输入框在使用过程中出现两个异常：

1. **抖动（Jitter）**：事件列表在短时间内连续重建两次，产生闪烁
2. **漏显（Dropped Renders）**：部分新到达的事件未被渲染到界面上

### 6.2 根因分析

#### 6.2.1 抖动：双重 `filterEvents` 竞态

搜索输入和事件更新存在两条独立的触发路径，它们会在短时间内连续调用 `filterEvents()`，导致 DOM 被重建两次：

```
时间线：
  T+0ms    用户输入字符 → searchInput 'input' 事件触发
  T+0ms    搜索防抖计时器启动（200ms 后执行 filterEvents）
  T+80ms   新事件到达 → updateEvents 消息 → 立即调用 filterEvents()
  T+80ms   filterEvents() → renderEvents() → 50ms 后执行 doRenderEvents()
  T+130ms  第一次 DOM 重建完成，列表刷新
  T+200ms  搜索防抖到期 → 再次调用 filterEvents()
  T+200ms  filterEvents() → renderEvents() → 50ms 后执行 doRenderEvents()
  T+250ms  第二次 DOM 重建完成，列表再次刷新 ← 用户看到闪烁
```

核心问题：`updateEvents` 处理器没有取消正在等待的搜索防抖定时器，导致 `filterEvents()` 在 ~170ms 内被执行两次，每次都触发完整的 DOM 清空和重建。

#### 6.2.2 漏显：`isRendering` 守卫静默丢弃

`doRenderEvents()` 使用 `isRendering` 标志防止重入，但当渲染正在进行时收到新的渲染请求，新数据被静默丢弃：

```javascript
// 修复前
function doRenderEvents(events) {
  if (isRendering) return;  // ← 新事件数据被直接丢弃，无重试机制
  isRendering = true;
  // ...
}
```

虽然 DOM 操作是同步的，理论上不会重入，但在高频更新场景下（多个 `filterEvents` 快速连续触发），50ms 渲染防抖的时间窗口内可能出现竞态，导致最新的事件集合未被渲染。

### 6.3 修复方案

#### Fix 1: 消除竞态 — `updateEvents` 取消搜索防抖

**代码位置**: `tea_event_radar/panel.js` — `chrome.runtime.onMessage` 监听器

```javascript
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'updateEvents' && message.events) {
    allEvents = message.events;
    updateEventCount();

    // 取消正在等待的搜索防抖，避免与下面的filterEvents重复执行导致抖动
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }

    // 应用当前的过滤条件
    filterEvents();
  }
});
```

**原理**：当新事件到达时，`filterEvents()` 会立即执行并读取当前输入框的值。此时搜索防抖定时器已经没有存在的意义（它最终也会执行相同的 `filterEvents`），取消它可以避免重复执行。

**修复后时间线**：

```
时间线：
  T+0ms    用户输入字符 → 搜索防抖计时器启动（200ms）
  T+80ms   新事件到达 → updateEvents → 取消搜索防抖 → filterEvents()
  T+80ms   filterEvents() → renderEvents() → 50ms 后执行 doRenderEvents()
  T+130ms  DOM 重建完成 ← 仅一次渲染，无闪烁
```

#### Fix 2: 渲染队列 — `pendingRenderEvents` + `requestAnimationFrame`

**代码位置**: `tea_event_radar/panel.js` — `doRenderEvents()`

```javascript
let pendingRenderEvents = null; // 队列：渲染期间到达的最新事件

function doRenderEvents(events) {
  if (isRendering) {
    pendingRenderEvents = events;  // 保存最新数据，而非丢弃
    return;
  }
  isRendering = true;

  try {
    // ... 渲染逻辑不变 ...
  } finally {
    isRendering = false;

    // 如果渲染期间有新的渲染请求排队，立即处理最新的
    if (pendingRenderEvents) {
      const nextEvents = pendingRenderEvents;
      pendingRenderEvents = null;
      requestAnimationFrame(() => doRenderEvents(nextEvents));
    }
  }
}
```

**设计要点**：

| 设计决策 | 选择 | 理由 |
|---------|------|------|
| 队列深度 | 仅保留最新一次（覆盖式） | 中间状态无意义，只需最终态 |
| 调度方式 | `requestAnimationFrame` | 让浏览器在两次渲染间完成绘制，避免同步递归 |
| 数据传递 | 通过闭包变量 `pendingRenderEvents` | 比 setTimeout 闭包更可控，数据可被后续调用覆盖 |

---

## 7. 防抖体系全景

修复后，扩展的完整防抖链路如下：

```
网络请求捕获
    ↓
Service Worker: debouncedUpdatePanel() — 100ms 批量推送
    ↓
Panel: chrome.runtime.onMessage('updateEvents')
    ├─ 取消 searchTimeout（消除竞态）
    └─ filterEvents()
         ↓
       renderEvents() — 50ms 渲染防抖
         ↓
       doRenderEvents()
         ├─ 正常渲染 → DOM 更新
         └─ 如果 isRendering → pendingRenderEvents 排队
                                  ↓
                              requestAnimationFrame
                                  ↓
                              doRenderEvents(queued)
```

```
用户输入搜索
    ↓
searchInput 'input' 事件 — 200ms 搜索防抖
    ↓
filterEvents()
    ↓
renderEvents() — 50ms 渲染防抖
    ↓
doRenderEvents() → DOM 更新
```

两条路径的关键交汇点在 `filterEvents()`，通过在 `updateEvents` 中取消 `searchTimeout`，确保同一时刻只有一条路径在执行，消除了竞态。

---

## 8. 配置参数

```javascript
// Service Worker 配置 (service-worker.js)
const MAX_EVENTS = 1000;           // 最大事件数量
const CLEANUP_THRESHOLD = 1200;    // 清理阈值
const UPDATE_DEBOUNCE_TIME = 100;  // 更新防抖时间(ms)

// Panel UI 配置 (panel.js)
const RENDER_DEBOUNCE_TIME = 50;   // 渲染防抖时间(ms)
const SEARCH_DEBOUNCE_TIME = 200;  // 搜索防抖时间(ms)
const MAX_VISIBLE_EVENTS = 100;    // 最大可见事件数量
const UPDATE_THROTTLE = 16;        // 拖拽节流，约60fps
```

---

## 9. 性能提升预期

| 指标 | 优化前 | 优化后 | 提升幅度 |
|------|--------|--------|----------|
| 内存使用 | 无限增长 | 限制在合理范围 | 减少 70-80% |
| 渲染性能 | 频繁卡顿 | 流畅响应 | 提升 60-70% |
| 响应时间 | 延迟明显 | 快速响应 | 减少 50-60% |
| 搜索抖动 | 列表闪烁 | 单次渲染，无闪烁 | 消除 |
| 事件漏显 | 高频下偶发丢失 | 队列保证最终一致 | 消除 |
| 稳定性 | 容易崩溃 | 稳定运行 | 消除崩溃风险 |

---

## 10. 测试建议

| 测试场景 | 方法 | 验证点 |
|---------|------|-------|
| 搜索抖动 | 在搜索框输入文字的同时，目标页面持续产生埋点事件 | 列表不闪烁，无二次重建 |
| 事件漏显 | 添加搜索关键词后，观察新到达的匹配事件是否正常显示 | 所有匹配事件均出现 |
| 长时间运行 | 让插件运行数小时，观察内存使用 | 内存稳定在预期范围 |
| 高频事件 | 在事件密集的页面测试插件稳定性 | 无卡顿、无崩溃 |
| 大数据量 | 累积大量事件后测试搜索和过滤性能 | 过滤响应 < 300ms |
| 多标签页 | 在多个标签页同时使用插件 | 各标签页独立稳定 |

---

## 11. 后续优化方向

以下为基于当前架构的潜在演进方向，仅供参考：

1. **虚拟滚动**：实现真正的虚拟化，只渲染可见区域，突破 100 条上限
2. **增量渲染**：新事件到达时仅追加 DOM 节点，而非全量重建
3. **搜索索引**：建立索引系统，避免每次过滤都对全量事件 `JSON.stringify`
4. **数据压缩**：压缩存储的事件数据，减少内存占用
5. **配置化**：允许用户自定义性能参数

---

## 附录：版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | — | 初始版本，基础事件捕获与展示 |
| 1.0.2 | — | 性能优化：内存管理、防抖节流、渲染批处理 |
| 1.0.3 | 2026-03-19 | 搜索过滤竞态修复：消除抖动 + 渲染队列防漏显 |
