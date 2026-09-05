# A/B 探查与 AI 解读 1.1.1

## 本次变化

- AI prompt 明确区分本地计数、可能实验数量、设计目的、组别假设、设置修改及实际证据；事实/推测、置信度与证据编号保留校验。
- AI 预览时读取当前顶层页面 HTML 结构、标题、描述、语言与脚本 URL。HTML 有节点、深度和长度上限，删除脚本、输入值、常见聊天消息区域及插件自身；URL 不发送查询参数。发送前可查看完整出站预览，只有确认后调用 API。自定义页面中的私有正文无法仅靠 DOM 通用规则完全判别，应检查预览。
- 将“解读当前网站”及取消操作移至 AI 解读 tab 内，统计数字缩至 16px。
- 新增域名背景目录：B 站、阿里/千问、字节/豆包、腾讯/元宝、智谱/GLM、MiniMax、Kimi、DeepSeek、Gemini、OpenAI、Claude。目录只识别背景，不以公司域名断言实验平台。
- Statsig 私有域名 initialize 结构支持 dynamic_configs/feature_gates；明确实验标记与普通配置区分。通用 ab_config、实验容器及未知候选结构保留为疑似线索。新增只读 bootstrap 状态扫描；非 JSON 候选响应显示采集缺口。
- DeepSeek 官方接口显式关闭默认思考模式，输出预算增至 8192；支持单个 Markdown JSON 代码围栏，分别报告空响应、长度截断、非法 JSON 和无效证据引用。无效输出不覆盖旧结果，不自动重试。

## 验证

- 30 项自动化测试通过：保守计数、Statsig 实验与开关区分、域名边界、陌生字段保留、敏感字段脱敏、JSON 围栏/截断/空响应/估计范围，以及原有后台权限、会话恢复、取消和超时。
- Chromium 源码浏览器流程通过：采集、iframe、暂停、设置、AI 预览/发送/安全渲染，以及原埋点搜索回归。构建版另运行同一流程。
- 真实 DeepSeek v4 flash API 已调用。输入为人工构造的实验配置/曝光与 HTML 样本，不是对生产网站实验的确认。成功响应记录见 `ai-live-1.1.1.json`，无密钥。初次调用被结论字段/证据校验拒绝，随后调用通过，说明供应商 JSON 模式不等于语义始终符合约定。
- 没有逐一登录上述生产站点验证专有协议。域名目录与通用兜底不是“所有私有方案均可解码”的保证；加密、Worker、流式私有格式、纯服务端实验仍可能不可见。

## 规则与接口来源

- [DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)：V4 默认思考，支持 `thinking.type=disabled`。
- [DeepSeek JSON 模式](https://api-docs.deepseek.com/guides/json_mode/)：JSON 输出约束与提示词要求。
- [Statsig SDK evaluator](https://github.com/statsig-io/node-js-server-sdk/blob/main/src/Evaluator.ts)：客户端初始化实验配置结构。当前测试为依据字段构造的协议样本。
- [Qwen](https://qwen.ai/qwenchat)、[Z.ai](https://docs.z.ai/guides/overview/overview)、[MiniMax](https://www.minimax.io/news/minimax-agent)：产品背景；不作为实验供应商证据。

最终复验：压缩版 Chromium 流程通过且无页面错误；真实接口连续两次成功，最终调用耗时约 6.7 秒，返回 5 条合法结论，覆盖数量、设计、组别、设置和校验。密钥模式扫描及 ZIP 完整性检查通过。

ZIP SHA-256：`04dd92cf48052be75c75d3348abf1ac502397f3bf759971140dc708b227fbb53`。
