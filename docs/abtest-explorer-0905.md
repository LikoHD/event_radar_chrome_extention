# A/B Test 探查与 AI 解读 — v1.1.4

> Status: Implemented; platform coverage is evidence-dependent
> Last synced: 2026-09-05
> Freshness: FRESH
> Scope: ab-*.js, ab-panel.css, ai-settings.*, manifest, panel, service worker

## 使用

加载 `dist` 或源码目录 `tea_event_radar`。点击插件打开网页内面板，顶部选择 **A/B Test**。浏览器侧边栏也使用同一面板。

- 首次打开 tab 即开始监控；手动暂停后再次切换保留暂停状态。刷新并完整采集按钮会刷新目标网页。
- 原埋点与实验监控独立启停。切换内部 tab 不暂停监控。实验会话按浏览器 tab + origin 隔离；同源 SPA/刷新保留，跨 origin 新建。子域名视为不同 origin。
- 列表区分已确认实验、未归属版本、疑似线索。没有字段就是未知；版本、参数、曝光数量不是实验数量。
- 展开查看原字段路径、参数、身份、时间线、请求与响应证据；身份默认部分隐藏，原始身份仅在本地展开。
- “相关上报”保留原始证据，关联原埋点记录需要原埋点监控也捕获过对应请求。原请求 ID 优先，缺失时按 URL 返回候选记录。
- JSON 导出与 AI 快照进行脱敏。原始本地证据仍可能包含业务敏感信息，清空可删除本次记录。

## 平台范围与规则依据

下表列出最初的公开协议适配范围；不表示任意 SDK 版本均可还原。后续实际访问 15 个网站及火山控制台，增加 B 站、腾讯 TAB、智谱、豆包参数服务和阿里 TPP 等规则，详见 [实际观察](research/sites-observed-2026-09-05.md)。历史调研保存在插件 ab-research.json 中，不能代替当前采集证据。

| 平台 | 已实现入口 / 字段 | 验证与来源 |
| --- | --- | --- |
| 火山 DataTester | LogAnalyticsObject / TeaAnalyticsObject；abtest_config 的参数、vid/value；abtest_exposure / ab_sdk_version；身份字段；私有域名结构 | 单元样本 + 本地站点真实网络链路。[集成](https://www.volcengine.com/docs/56651/783982)、[调试](https://www.volcengine.com/docs/56651/783983?lang=zh) |
| 神策 | SensorsABTest；$ABTestTrigger；$abtest_experiment_id / $abtest_experiment_group_id；复用分析模块的 Base64/Gzip 解码 | 协议样本。[Web SDK](https://manual.sensorsdata.cn/abtesting/docs/abtesting_web)、[源码](https://github.com/sensorsdata/abtesting-sdk-web) |
| Quick Tracking | aplus.qt_abtest；expid / gid / value，排除空 ID 默认值 | 协议样本。[Web SDK](https://help.aliyun.com/zh/document_detail/2865521.html) |
| Optimizely Web | SDK 只读实验状态；experiment_id / variation_id；id / experimentName / variation.id | 协议样本。[State](https://docs.developers.optimizely.com/web-experimentation/reference/state) |
| GrowthBook | 明确带 GrowthBook 证据的实验定义 key / variations、实验结果 experiment / result、experimentId / variationId | 协议样本。[SDK](https://docs.growthbook.io/lib/js)、[DevTools](https://github.com/growthbook/devtools) |
| PostHog | $feature_flag / $feature_flag_response；$feature_flag_has_experiment=true 才确认为实验，否则疑似开关 | 协议样本。[SDK](https://posthog.com/docs/libraries/js/usage) |
| VWO | _vwo_exp 配置、_vis_opt_exp_*_combi 历史 Cookie；显式 campaignId / variationId | 协议样本。[Variation Applied](https://developers.wingify.com/reference/variation-applied)；历史 Cookie 不证明当前生效 |
| Statsig | 平台证据 + experimentName / ruleID 等显式字段 | 基础协议样本。[设备级实验](https://docs.statsig.com/guides/first-device-level-experiment) |
| AB Tasty | 平台证据 + testId / variationId | 基础协议样本。[浏览器历史](https://docs.abtasty.com/client-side/tag/tag-campaign-history) |
| LaunchDarkly | key / variation，reason.inExperiment=true 才确认为实验 | 基础协议样本。[JS SDK](https://launchdarkly.com/docs/sdk/client-side/javascript) |
| 自研 / 未知 | experiment_id、experimentId、exp_id、abtest、ab_version 等显式结构 | 疑似线索，group_id 单独出现不算实验 |
| 百度统计实验 / 腾讯云 AB | 尚无已验证网页协议适配器 | 候选范围，不能将普通统计脚本或公司域名视为实验方案证明 |

美团、京东、字节、阿里、腾讯、百度、快手、小红书等公司网站不预设统一实验平台；只有当前可见协议证据匹配时才标注产品，否则使用通用线索解析。

## 架构与边界

- `ab-core` 提供平台识别、规范记录、统计、校验提示和脱敏快照，独立于原分析平台适配器。
- `ab-worker` 在现有后台注册独立采集与控制消息。请求使用 webRequest；响应来自 MAIN world fetch/XHR 探针。只读状态通过隔离世界桥接。
- `ab-probe` 保留原 fetch 返回 Promise 和 XHR 行为，不重发、拦截或修改响应，不调用实验求值 API。可读 JSON/text 响应按 512 KB 上限读取，候选结构才解析上送。
- 桥接数据属于页面可伪造的观察证据，不能据此读取配置或执行 AI。worker 检查消息来源、大小、类型、活动 tab；身份与平台判断不声称具备防伪认证。
- 请求与响应保留独立证据 ID；只有同来源同 ID 才去重，不凭相似内容合并不同请求。不把未知项目/环境强行关联到已知项目。
- 每会话最多 1,000 份原始证据，同时有 2 MB 证据字节预算；每记录保留 100 条历史、1,000 个证据引用；超过 8 KB 的单份规范参数保留字段名及截断标记，原值仍可在尚未淘汰的本地原始证据查看。最多 2,000 条记录，超出时显示截断。跨会话保存预算为 7 MB，必要时继续缩短历史。摘要/参数极大导致保存失败时明确标记，不宣称完整恢复。
- 会话保存在 chrome.storage.session；后台 worker 重启可恢复，浏览器重启清空。AI 完成期间保持后台活动；结果绑定原始快照，后续证据使其标为可重新解读。
- 配置中缺少身份不等于身份变化；只有同一身份字段观察到不同值才提示变化。
- Worker、原生 WebView bridge、HttpOnly Cookie、不可读取响应、早于控制握手的初始化请求、私有加密/二进制协议、纯服务端实验不可保证捕获。SDK 读取快照与历史 Cookie 不证明当前曝光。
- 曝光表示观察到协议上的曝光记录，不代表访客实际看到 UI；HTTP 成功不代表平台已统计。

## AI 设置与接口

独立 options 页；Base URL 默认 `https://api.deepseek.com`，模型默认 `deepseek-v4-flash`。只接受无 URL 凭据、查询或 fragment 的 HTTPS Base URL，可带 `/v1`。POST `/chat/completions`，Bearer Key，JSON response_format，非流式，4,096 输出 token 上限。

密钥存在 chrome.storage.local；local/session 限制为 TRUSTED_CONTEXTS。原内嵌面板宽度改为专用后台消息，避免存储访问限制影响原功能。设置接口不回传密钥正文。

模型调用只允许扩展 panel/options 来源。点击解读后后台自动生成一次性 token，绑定 tab/会话/模型/地址，有效期 10 分钟，最多保留 5 份，并通过会话存储跨后台重启保留；随后直接发送，无弹窗或二次确认。证据摘要上限 120,000 字符，自动减少记录时显示截断。每条历史最多 15 个近期观测进入快照。没有原始证据可引用时拒绝解读。

请求不包含原始整包数据，只包含规范实验参数、必要页面路径和证据元数据。身份以会话内代号替换，敏感字段移除、URL query/hash 去掉；另附脱敏 HTML、页面背景和按域名匹配的历史调研；自定义业务字段仍可能包含无法按通用规则识别的敏感信息。API Key 永不进入快照或导出。

响应约定：`findings[{type:fact|hypothesis,text,confidence:high|medium|low,evidenceIds:[]}]`，`missingEvidence:string[]`，`nextChecks:string[]`。类型和证据引用不合法时拒绝结果；有效引用本身不证明模型解释正确。AI 不修改本地实验计数。

请求可取消，60 秒超时，不自动重试；401/429/网络/格式错误明确提示。失败保留上次成功结果。网页和模型内容使用 textContent 渲染。真实 DeepSeek 账号调用需用户自行配置密钥；当前验证使用模拟接口。

## 验证

- `npm test`：纯解析、脱敏、模型协议、后台权限与会话测试。
- `PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser-smoke.cjs [source-or-dist]`：隔离临时 Chrome for Testing profile、本地 HTTP fixture、真实扩展注入、响应与曝光采集、暂停、密钥访问隔离、AI 一键模拟发送、原埋点回归。测试不读取日常 Chrome profile。
- `npm run build`：复用现有 Terser 构建，检查源码/产物均可加载。
- 来源与协议样本不等同于生产站点兼容测试；新增网站遇到未知形状时保留疑似线索，后续按脱敏样本补充适配。

## Evolution Log

### 2026-09-05 A/B monitor and AI interpretation
**Before:** 仅埋点监控及平台识别。
**After:** 独立 A/B tab、证据关联、保守计数、只读响应探针、独立模型设置和手动证据解读。
**Reason:** 辅助实验校验与目的反推。
**Impact:** 新增 options 页、MAIN/isolated 探针；最低 Chrome 111；现有用户改动保留。

### 2026-09-05 v1.1.4 交互与调研同步
**Before:** 手动启动、预览确认、操作区位于顶部。
**After:** 首次切入自动监控，操作区固定底部；AI 子页显示进度并一键发送，方案总结按统计分类展开。16 条历史调研随当前证据参与分析。
**Reason:** 缩短监控与解读流程，同时保持事实和推测分离。
**Impact:** 新增 ab-research.js/json；45 项测试和压缩版浏览器回归通过。
