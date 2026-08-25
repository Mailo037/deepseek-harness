# Agent Note: Composer voice input over the browser speech API

Status: implemented

[English](2026-08-24-voice-input-composer-mic.md) | 中文

## 问题

Composer 只接受文本、文件与引用，没有语音输入：用户想口述消息时只能切换到其他工具再粘贴。语音模式应当录制麦克风、转写，并把文本放入 composer 草稿。

## 决策

`@deepseek-ai/dsh-client-ui-voice-input` 注册 composer 的具名 `conversation.input.voice` seat——一个纯图标麦克风按钮（无轮廓、无背景），由 InputBar 渲染在上下文仪表与发送按钮之间。点击启动浏览器的 SpeechRecognition API（在 Windows/Edge 上即操作系统语音平台），再次点击停止；启用 `continuous` + `interimResults` 后，每次结果事件都会把草稿重写为录制前基础草稿加累积最终转写（以单个空格连接），用户可看到转写不断增长，并可像普通草稿文本一样编辑或发送。出错时恢复基础草稿并通过按钮标签提示；`aborted`（用户主动停止）保持静默。浏览器未暴露识别器时该 seat 不渲染；composer 锁定或输入机繁忙时禁用；锁定到来或组件卸载时中止活动识别器。按钮从不抢占输入框焦点。

该 seat 是纯浏览器表面：不发起 Host 请求、不产生 Session 事件、不生成投影，除用户发送的草稿文本外不产生任何模型可见输入。`voice` 语言命名空间承载按钮与错误文案（中英双语，中文为键集源）。

## 备选方案

**复用 `conversation.input.right` 列表 slot。** 该 slot 的条目渲染在模型选择左侧，而需求把麦克风放在模型选择与发送按钮之间（上下文仪表位于其左侧）；具名 seat 模式（plan、model）已为这类 composer 工具行控件存在，因此第三个具名 seat 沿用既有形态，且只有一个 owner。

**经 Host/agent 路径直接发送转写，而非写入草稿。** 草稿是 composer 自己的写路径（`inputActions.setDraft`），保留撤销与 occurrence 语义，并允许用户发送前审阅；直接发送会跳过审阅，并增加第二个提交表面。

**包内私有引擎或操作系统原生桥。** 浏览器 SpeechRecognition 即平台默认（Edge 上的 Windows 转写），无需后端、凭据或原生代码；其他方案需要承担引擎配置、网络与模型选择策略，而本功能目前并不需要。

## 后果

Composer 增加一个无框开关控件；在不支持该 API 的浏览器上该 seat 为空（不渲染），布局保持不变。录制期间草稿尾部归录制所有：录制中键入的内容会被下一条结果事件覆盖，基础草稿在开始时捕获，出错时精确回滚到它。识别质量、语言覆盖与网络行为跟随浏览器引擎——已记录在包 README 的已知限制中。seat 声明位于 ui-conversation 的 composer-bar 契约（`ComposerBarProps` 渲染它）；组件测试以假识别器驱动完整的开始/流式/停止/出错/锁定/卸载矩阵，浏览器插件测试证明注册与释放（HMR 安全）。
