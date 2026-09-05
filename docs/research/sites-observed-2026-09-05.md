# 2026-09-05 实际网站 A/B 协议观察

本次在 Chrome 独立研究标签页分批访问下列 15 个入口，读取页面原本发出的请求和配置响应。没有主动切组、调用分流接口或发送聊天。结论仅适用于当次页面、访客状态与可读数据；登录后、其他页面和时间可能不同。请求编号是本次 DevTools 会话索引，不能跨会话复用。

## 第一批：国内主要网站

| 实际访问入口 | 实际接口 / 证据 | 观察结果与插件处理 |
| --- | --- | --- |
| www.bilibili.com | 首页 HTML 请求 1，`window.abtest` | `ab_version` 含 `for_ai_home_version: V8`、`rcmd_timeout_config: 550`，对应 `ab_split_num` 为 125、73。保留两条配置线索，不把分桶数字解释成流量比例或实验 ID。KV 接口返回 Not Modified，不能据此补全配置。 |
| www.qianwen.com | `aide.qianwen.com/api/general/config/query` 248；CMS 265/266 | 配置查询未成功；完整检查两份 CMS 响应（约 132 KB、63 KB），未找到明确实验字段。编码埋点不能直接解析。本次没有确认实验平台。 |
| www.doubao.com/chat/ | `mcs.doubao.com/service/2/abtest_config/` 429/448；`/list` 449；`/samantha/user/ab/get` 726 | DataTester 应用 497858，配置包含 `val/vid`，事件含 `ab_sdk_version`；另一个接口有 `data.ab_results`，如 `deep_thinking_auto: optional`、`simplify_preset_prompt_version: v2`。两套证据分开处理，VID 不充当父实验 ID，空参数不生成线索。 |
| yuanbao.tencent.com | `rdelivery.qq.com/v1/config/pull` 1058，HTTP 200 | 在 `bizContent.tab.expData` 的 JSON 字符串中观察到 3 个带 `expName/assignment` 的实验；保留 `sGrayPolicyId/bucket/percentage` 和配置原值。普通远程配置不算实验。bootstrap 返回 401，观察范围不等于登录后完整状态。 |
| www.taobao.com | MTop `mtop.relationrecommend.wirelessrecommend.recommend/2.0/` 1401，HTTP 200 | `data.tpp_buckets` 为 `46976#0#464877#0_46976#57252#521538#96_46976#57251#521536#9`。仅作为一条不透明分桶线索，未验证各段语义，不能据此统计 3 个实验。 |
| www.douyin.com | `/service/2/abtest_config/` 1779，HTTP 200 | 完整响应约 49 KB，488 个 `val/vid` 配置。修复遍历只看前 200 个字段的问题。配置数量不等于实验数量；请求携带旧版本列表也不等于曝光。 |

## 第二批：模型产品

| 实际访问入口 | 实际接口 / 证据 | 观察结果与插件处理 |
| --- | --- | --- |
| chatglm.cn | `/chatglm/operation-api/experimental/groups` 2183，HTTP 200 | `result.group_names` 23 个 `名称:exp或control:组名` 字符串。按名称统计，只有明确 `control` 标记认定对照组。样本中的 `drawing_server_hi_dream:control:A` 可判断对照角色；其他 A/B 后缀不能单独判断。含 mobile/android 名称不证明作用于当前网页。 |
| agent.minimax.io | `/v1/api/config/web/common_config` 2346/2470；`/minimax-cloud/api/v1/config` 2468 | 完整检查约 80 KB 配置，没有找到明确实验字段。模型 `supported_variants: ["", "thinking"]` 是负例，不能判为 A/B 实验。 |
| www.kimi.com | `tab.volces.com/service/2/abtest_config/` 2623/2776；`gator.volces.com/list` 2765 | 15 个 `val/vid` 参数与上报版本列表；包括会员落地页、侧栏等参数。保留未归属版本，不反推 15 个父实验。另一个 GetConfig 的可读配置没有提供父实验标识。 |
| chat.qwen.ai | `/api/v2/configs/setting-config` 2831；`/api/v2/configs/` 2832 | HTTP 200，可读设置未发现明确实验字段；当次为未登录入口。不能把国内千问接口规则直接套到此站。 |
| chat.z.ai | `/api/config` 3629；`/api/models` 3630；`/api/v1/scene-cfg/` 3639 | 完整检查约 255 KB 模型配置与 174 KB 场景配置，没有找到明确实验字段；有统计 SDK 不等于有实验平台。未观察到 chatglm.cn 的 groups 协议。 |

## 第三批：海外网站

| 实际访问入口 | 实际接口 / 证据 | 观察结果与插件处理 |
| --- | --- | --- |
| gemini.google.com | `BardChatUi/data/batchexecute` 2890/2891/2901；HTML 2869 | RPC 为带防 XSSI 前缀的私有数组协议，选取样本未找到可解释实验标识；完整 HTML 约 845 KB，WIZ 全局对象使用不透明键。CSS experiment badge 不算实验。当前不声称支持还原该私有协议。 |
| chatgpt.com | `/unauth-mweb/events/statsc/flush` 3154；HTML 3038 | 本次进入未登录移动网页入口；statsc 请求是 counters/histograms 性能指标，不是 Statsig 实验。页面与选取埋点中未发现明确实验字段，不推断整个 ChatGPT 无实验。 |
| openai.com | `ab.chatgpt.com/v1/initialize` 3325，HTTP 200；`/v1/rgstr` 3338 | 实际为 Statsig 自定义域名，完整响应约 4.9 MB，包含 feature_gates、dynamic_configs、layer_configs。研究工具读取完整配置，但插件遵守 512 KB 上限，只保留平台依据和缺口。样本覆盖 active/inactive/config 状态；不把配置目录总量当成本站运行的实验数量。rgstr 请求压缩，未解码确认曝光。 |
| claude.ai/login | `/edge-api/bootstrap` 3459，HTTP 200 | 初次站点检查自动结束后进入登录页；观察到 GrowthBook 143 项 features，多为 defaultValue，没有明确分组。另有空 Statsig 容器，不足以确认实际 Statsig 实验。默认值中的 control/v1 不构成对照分组证据。 |

## 真实案例对 AI 的约束

腾讯样本中，名为 `infra.network.http_response_gzip_threshold_integer` 的配置附带 `exp_ai_picture_silent_upload_aigc` 实验名。名称指向不同业务，AI 必须保留这种不一致，不能仅根据名字编造确定目的。`percentage` 只描述当前可见配置，不能扩展为全站流量分配。

B 站分桶数字、阿里 TPP 字符串、模型能力 variants、默认 Feature Flag、未激活 Statsig 配置均不能直接计入确定实验。智谱返回的移动端命名分组，不能直接当作当前网页正在执行的功能。AI 输出继续区分本地事实、候选目的、分组推测与缺失证据。

## 交付与可复现验证

真实响应经过最小化截取，保留与协议有关的字段，存于 `tests/fixtures/sites-observed-2026-09-05.json`；未保存账户身份、认证头或聊天正文。`tests/sites-observed.test.cjs` 验证这些样本，另用 488 字段构造测试防止遍历截断回归。

这次真实访问确认了接口和可读协议；不等同于每个平台都完成了所有登录态、页面和曝光链路验证。插件端到端交互使用本地受控站点验证；OpenAI 大响应、Gemini 私有 RPC、编码上报以及本次未观察到实验的站点仍明确保留覆盖限制。
