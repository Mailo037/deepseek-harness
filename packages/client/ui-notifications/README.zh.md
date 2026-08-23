# @deepseek-ai/dsh-client-ui-notifications

[English](README.md) | 中文

通知音效插件：General 设置中的选择性行、四个内置 Web Audio 音效，以及在会话列表快照发生与侧边栏状态圆点相同的转换时播放对应音效的监听器。Host 侧注册持久的 `ui-notifications` 设置命名空间；没有设置服务时偏好仅保存在当前进程（memory 模式）。

监听器订阅共享会话列表快照存储，每次刷新对每行至多派生一个事件：行的 `attention` 首次出现时触发 `error`，`pendingInteraction` 首次出现时触发 `attention`，运行结束或首个后台任务完成且无其他待处理事项时触发 `done`。同一次刷新内优先级为 error > attention > done，一个音效总是命名最紧急的圆点状态。subagent 来源的行保持静音——其生命周期通过父会话的后台活动呈现。转换只相对上一次观察的快照派生：启动与重连重拉只建立基线，从不重放已有状态。

音效为合成生成（振荡器 + 增益包络），打包产物不含音频资源。挂起的 `AudioContext` 在播放时恢复；恢复被拒绝或缺少 WebAudio 支持时静默而非抛错。

## Model Experience

无。本功能读取客户端列表摘要并写入一个 Host 用户设置节；不触及任何模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **音效事件目前只覆盖顶层会话行** — 超出"首个完成任务"粒度的后台任务级音效与 subagent 子任务完成音效，待有消费方再推进。
- **无桌面通知** — 本面只有声音；浏览器 Notification 权限流程暂缓。
