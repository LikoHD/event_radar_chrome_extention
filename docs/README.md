# Docs Index

> Last synced: 2026-03-22

## 当前应优先阅读

| 文档 | 角色 | 说明 |
|------|------|------|
| `product-technical-spec.md` | Current source of truth | 当前代码实现、架构、能力边界 |
| `documentation-sync-2026-03-22.md` | Sync audit | 这次文档检查发现的缺口、已补内容、仍待同步项 |

## 历史阶段性文档

| 文档 | 状态 | 说明 |
|------|------|------|
| `event-parsing-enhancement-spec.md` | 历史里程碑 | 记录 2026-03-20 的 17 平台增强阶段，不代表当前全部覆盖 |
| `performance-optimization-spec.md` | 专项说明 | 性能策略仍可参考，但不是完整产品现状 |

## 研究参考文档

| 文档 | 状态 | 说明 |
|------|------|------|
| `analytics-platform-tracking-spec.md` | 研究参考 | 只覆盖 17 个主流平台的公开/抓包研究，不等于当前代码全部适配器 |
| `analytics-platform-tracking-reference.md` | 研究参考 | 对上面文档的扩展版参考材料 |

## 当前实现快照

- 当前按 `manifest.json` 记版本为 `1.0.5`
- 当前已识别平台适配器数量为 `36`
- 支持 Side Panel 与页内 iframe 面板
- 支持 Regex 过滤规则、白名单和预设
- 支持保存可疑二进制 body 的 base64，并做神策 / 知乎异步二次解码

## 备注

- 根目录 `README.md` 和 `tea_event_radar/README.md` 仍存在早期描述，未在本次 `docs/` 范围内同步修改。
- 如果后续继续扩平台，优先更新 `product-technical-spec.md`，再决定是否补研究参考文档。
