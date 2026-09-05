# 插件视觉迁移

参考：https://console.volcengine.com/datafinder/project/2111833/event-analysis
方法：https://github.com/JCodesMore/ai-website-cloner-template/blob/master/.codex/skills/clone-website/SKILL.md

用户范围优先：在原生 JavaScript 插件中迁移设计，不搭建 Next.js 网站、不复制业务数据，不改变采集与模型业务逻辑。

## 提取与映射

浏览器已访问事件分析页面并提取 computed styles。原站强调色 rgb(48,115,242)，正文 rgb(47,47,63)，次级按钮背景 rgb(250,251,252)，边框 rgba(27,31,35,.12)，按钮圆角 4px；正文/输入 13–14px，标题 18px。
保留本地插件 logo 与资源，使用系统中文字体回退；白色卡片、浅灰工作区、蓝色活动标签适配窄面板。

顶部：Event Radar 与 A/B Test 为同级点击标签，方向键/Home/End 可切换；右侧原有设置按钮打开统一抽屉。
设置：内置 AI API 表单复用 ai-settings.js，保留过滤规则、白名单与预设。独立 options 页面继续可用。
内容：保留埋点事件列表及 A/B 实验、上报、AI 解读内容与原有交互。

未添加原站的业务导航、图表或项目数据，因为这些超出纯设计迁移范围。响应式采用插件的 320–400px 面板布局，不照搬原站桌面侧栏。
