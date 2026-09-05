# 火山控制台实测与 1.1.2 验证

观察日期：2026-09-05。用户指定页面：
https://console.volcengine.com/datafinder/project/2111833/dashboard/7447796126314399744

只刷新并被动读取页面已有请求，未修改看板、项目配置、授权或分组，未重放接口。记录不含身份、Cookie、鉴权或完整报表业务数据；本次没有将控制台数据发送给外部模型。

## 真实证据

- 配置：POST https://abtestvm.bytedance.com/service/2/abtest_config/，HTTP 200；请求 header.aid/app_id 对应 3569，返回 data 参数采用 val + vid。
- 上报：POST https://mcs.zijieapi.com/list，HTTP 200；app_id=3569 的事件级 ab_sdk_version=92428570。事件包括 platform_storage_usage、predefine_pageview、monitor_page_show、console_web_pkg，属于附带版本的普通事件；观察窗口未见明确曝光事件。
- 同页另有 app_id=1229、15001 的上报，不与 3569 直接合并。
- 路由 project/2111833 对应看板中的 Demo 电商项目，不等于 SDK 实验应用 3569。
- TCC 静态配置接口 /obj/tcc-config-web/tcc-v2-data-dp.tob.finder_fe-default 返回配置版本与功能参数；没有证据证明它是随机 A/B 实验。

| 参数 | 当前 val | vid |
|---|---|---|
| group_auto | "ctr_grp" | 17155496 |
| group_export | "ctr_grp" | 16625100 |
| group_expres | "exp_grp" | 16821626 |
| group_ins_group | "ctrst_grp" | 16278130 |
| group_todo | "ctr_grp" | 16821566 |
| group_unpaid | "ctr_grp" | 16821714 |
| intranet_use_bytehi | true | 90127783 |
| online_use_bytehi | true | 90128021 |
| pre_sales_use_bytehi | true | 90128022 |
| search_ai_mode | "exp_grp" | 92428570 |
| sideMenuABRoot | {"hasText":false} | 90097654 |

本次观察到 11 个配置参数、11 个不同版本，0 个可见父实验 ID。不能据此声称存在 11 个独立实验，也不能声称没有实验。search_ai_mode 的配置版本与实际事件版本一致；其余配置下发不证明被求值或曝光。

## 设计假设（均未确认）

- search_ai_mode=exp_grp：可能测试控制台 AI 搜索入口或搜索模式。候选校验指标是搜索入口点击、查询完成或后续产品到达；未观察到这些指标定义，不能用 GMV 替代。
- sideMenuABRoot.val.hasText=false：可能测试导航是否显示文字。可能影响导航识别与访问路径；没有另一组或前后 UI 对照，不能确认具体交互差异。
- intranet/online/pre_sales_use_bytehi=true：可能是不同服务场景的助手渠道或配置迁移，也可能只是灰度开关。不能凭 true 判断实验组。
- group_auto/export/expres/ins_group/todo/unpaid：名字和 ctr_grp、ctrst_grp、exp_grp 提供语义线索，缺少功能消费点和正式角色定义，不展开成确定实验。

## 实现与测试

1. 同时解析 value/val，原始字段名保留；VID 不升级为实验 ID。
2. fetch/XHR 被动读取现有字符串请求体中的 app_id/aid，只桥接应用 ID，不桥接身份或鉴权；响应因此能与同应用上报关联。不额外读取 Request 对象流，无法获得应用 ID 时保持未知，避免猜测合并。
3. 分流请求携带的既有版本单列阶段；普通事件附带版本不记为曝光。晚到配置可补全已观测版本的参数名称。
4. AI 输入补充参数清单、参数数、已上报版本；Prompt 强制区分控制台、业务应用、客户项目，并按参数→值→版本→事件组织证据链。
5. HTML 优先应用主体，去除不可见节点，另给可见标题/按钮背景，降低全站菜单挤占上下文预算的问题。
6. 真实字段样本 tests/fixtures/volc-console-observed.json 已脱敏；33 项自动化测试通过，包括同 app_id 关联、跨应用不合并、val 支持、旧版本请求阶段和 fetch 原始 Promise/响应语义。

生产站点网络协议已实际观察；新版解析器使用这些脱敏样本回放验证。其他平台的真实验证状态不因此改变。


压缩版 Chromium 集成流程通过，无页面错误：采集、iframe、暂停、AI 预览与发送（模拟接口）、原埋点搜索回归均通过。ZIP 完整性检查通过，SHA-256：`7db655dea1706d339150d7c8dcd6fd07196ff3fb8eb130304665b6ed1a95fe9e`。


后续界面调整：移除顶部站点/采集描述，新增全部实验平台下拉筛选与参数搜索行，统计改为搜索下方的 12px 紧凑数字。平台筛选、参数搜索及 AI 子页的压缩版浏览器回归通过。更新包 SHA-256：`5a89754e80ef9d7a0814b7a636b39f1e2530002546691f549add16a573028d4b`。
