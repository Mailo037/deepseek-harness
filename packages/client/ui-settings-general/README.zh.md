# @deepseek-ai/dsh-client-ui-settings-general

[English](README.md) | 中文

设置外壳、无特定功能归属文案与持久化产品引导 namespace。它以触发控件和模态设置面板占用 `sidebar.settings`，把 `settings.section` 账本投影成导航、把 `settings.onboarding` 账本投影成每次只挂载一个步骤的引导流程，并在设置页面上注册所有不属于单一功能的内容：触发器、标题栏与关闭控件内容、本地配置文件操作、「通用」与「关于」分区、`settings.general.item` slot，以及 `settings` 字典。它渲染进的那些 slot 类型归 ui-settings——设置领域底座——所有；只有外壳自身的契约类型放在这里，因为它们引用 ui-sidebar 的 slot 类型，而底座不得依赖任何 `ui-*` 包。归具体功能所有的行（「权限」、「语言」、「外观」）、分区（「模型」）和条件式首次使用引导步骤仍由各自的功能包提供。面板打开时，root-scoped `dsh.settings.navigation` store 会把面板及选中的分区留在浏览器 localStorage 中，因此刷新后会回到同一设置分区；关闭面板会清除该查看状态。若某个贡献分区暂未注册，面板会先渲染第一个可用分区，直到该分区重新注册。模态面板为单列布局：标题栏一行，标题在左上、分区操作与关闭按钮在右上；其下是横向滚动的分区标签行；再往下是承担全部纵向滚动的内容区。在 640px 以下，面板变成全屏面板并保持同一结构、仅收紧内边距，因此内容在手机 viewport 上不会被挤压成一条窄缝。

「关于」分区从共享 describe 镜像渲染宿主安装的身份信息——版本号、运行环境（网页／桌面）、git 分支、短提交哈希、远程仓库 URL——并通过共享 `UpdateStore` 渲染更新状态：手动检查，以及宿主报告上游有新提交时的一键**立即更新并重启**。Web 更新期间，一个 `shell.overlay` occupant 会用**正在应用更新**、本地化的 pull／build／start 状态和自动滚动的终端取代普通的连接丢失视图；终端最多保留 runner 最近 80 行 stdout／stderr。每个打开的标签页都会在重连期间轮询保留 origin 上的分离 runner；新宿主应答后，每个标签页都以用于避开缓存的 `__dsh_update` 查询导航一次，并在加载后移除该标记，因此所有标签页都会采用新的前端产物。runner 失败时会保留状态 endpoint、显示错误，并提供包含有界且自动脱敏日志、可供检查的 GitHub Issue 草稿；未经用户在 GitHub 上确认，不会提交 Issue。有可用更新或正在应用时，侧边栏触发图标会画一个蓝点。只有环回客户端且宿主报告存在 git 检出、启动器可自我替换时才会自动检查；线上协议中 `host.checkUpdate`／`host.applyUpdate` 均被钉在环回上。

同一分区还提供独立且可选的 **AI 辅助更新**流程。来源选择器默认使用持续维护的 `Mailo037/deepseek-harness` 发行版，也可改为 DeepSeek 官方的 `deepseek-ai/deepseek-harness` 上游。加载所选工作区由宿主报告的模型目录不会消耗 AI 额度；只有用户选择审查模型并明确启动可见会话后才会发起模型请求。持久化提示会报告来源版本与 Git 分歧，区分来源改动、发行版维护行为和本地用户定制，并在修改受跟踪文件前等待批准。获准后的工作保留在隔离的 `harness-sync/*` 分支和 worktree 中；提示要求保留本地改动、禁止修改活动工作树，也排除 push、merge、发布、部署或重启。普通快进更新器仍可在不使用 AI 的情况下运行。

外壳不自带引导文案：所有文本都来自注册方。导航 label 可以是跟随语言的 thunk，因此导航投影经 `resolveSlotLabel` 解析，并在分区账本更新或 locale revision 变化时重新渲染（`ctx.get('locale')` 可选读取，无硬 locale 依赖）。首次使用引导记录按升序投影，每次只挂载一个步骤；可见步骤自行持有弹窗框架和应用根节点 `inert` 生命周期。已挂载但仍在判定私有事实的步骤渲染 null，因此判定期间不绘制也不阻塞任何内容。当前注册方会收到该条目的 id、`complete()` 和 `openSection(id)` 回调；完成或跳过当前步骤后，所有权转交给下一项。持久化完成状态、能力就绪状态、文案、变更操作以及可见包装均由注册方持有，因此独立注册的流程无法堆叠，外壳也不会成为第二个配置事实来源。

回环浏览器通过 `settings.describe` 加载提供方的 `hasDocument` 能力，且只有在 Host 确认可准备好一份由提供方持有的本地文档时才渲染**打开配置文件**。该操作发送无路径参数且仅限回环访问的 `settings.openDocument` 请求；Host 会再次解析提供方路径、在文档缺失时将其创建出来，并交给原生文本编辑器（macOS 上使用 `open -t`，绕过浏览器文件关联；Linux 和 Windows 上使用桌面文件关联；WSL 上经 `wslpath -w` 转换后使用 Windows 文件关联）。打开失败时该操作仍可使用，并渲染本地化错误。临时读取失败或 Host 拓扑变化后，重新打开对话框或重新连接会刷新可用性。远程浏览器从不注册该操作，也从不发起这项特权设置读取。

宿主端在用户设置 seam 中注册 `ui-onboarding`。`ui-settings-models` 提供的欢迎步骤通过既有公开 settings 边界读写其中的 `welcomeNoticeVersion`；外壳本身仍不持有产品策略。

## 模型体验

### AI 辅助更新请求

#### 模型看到的内容

选择**开始 AI 更新**会向准备好的可见会话追加一条持久化 user-role 消息。下方占位符分别由来源角色、本地工作区路径和所选仓库填充。仅打开设置、更改来源或加载模型目录都不会向模型发送任何内容。

##### 更新审查消息

```markdown
Review and safely integrate applicable changes from <source-role> into this locally customized Harness.

Local working tree: <workspace-path>
Selected update source: <repository-url>

First read the repository's AGENTS.md and every instruction file that applies to files you inspect or change. Then:

1. Inspect the local Git status, local commits, remotes, and version. Treat every pre-existing tracked or untracked change that is not proven to come from the selected source as user-owned customization; preserve it regardless of who authored it.
2. Discover the selected source's default branch and newest release tag. Fetch it into a namespaced remote-tracking ref without switching the active branch.
3. Report the local version, selected-source version, merge base, ahead/behind counts, and the important source changes since that base.
4. Build a three-part change ledger: selected-source changes, maintained fork/product changes, and local user customizations. Classify each source change as integrate, adapt around a customization, or intentionally leave out, including migrations, documentation, tests, and likely conflicts.
5. Present a concrete integration plan and wait for my explicit approval before editing tracked files.

After approval, work on an isolated harness-sync/* branch and worktree. Integrate deliberately instead of blindly merging the selected source. Reapply compatible source changes while retaining maintained-fork behavior and local user customizations; resolve every overlap explicitly and test both the updated product behavior and preserved customization. Never reset, rebase, merge, or clean the active working tree. Do not push, merge, release, deploy, or restart the app without a separate explicit request. Finish with the exact source changes integrated, customizations preserved, checks, remaining gaps, and a review path.
```

#### Token 影响

用户启动可选流程前为零。启动后，固定审查说明和三个简短部署值作为普通持久化用户历史写入一次；之后的分析和工具结果取决于实际数据。

#### KV Cache 影响

新的用户消息追加在可复用前缀之后。只要持久化会话历史保持一致，后续轮次就可继续复用未变的前缀和此消息。

## 已知限制与暂缓事项

- 「通用」分区没有内置行；每一行仅在其所属功能插件挂载时出现。
