# dsh-credentials-local

[English](README.md) | 中文

本地[凭据](../credentials/README.zh.md)提供方：四层来源、一套明确的优先级，并对 provider 管理的值采用 Windows 当前用户级加密。

| 层 | 来源 id | 可写 | 优先 |
|---|---|---|---|
| 继承的进程环境 | `env` | 否 | 始终优先 |
| `$DSH_HOME/.credentials.yaml` 文档 | `file` | 是（`set`/`unset`） | 高于两个 `.env` 层 |
| `<invocation cwd>/.env` | `project-env` | 不在此处 | 高于用户 `.env` |
| `$DSH_HOME/.env` | `user-env` | 不在此处 | 其余情况 |

启动环境优先，因为按次覆盖（`DEEPSEEK_API_KEY=… dsh`、CI 机密、容器 `-e`）代表本次运行的操作者意图——而它无法从进程内部修改，就必须*可见地*只读：`describe()` 报告 `source: 'env', writable: false`，`set`/`unset` 直接拒绝，而不是写下一个读取方永远看不到的变更。

它之下的所有来源优先级都低于受管存储，因此 Models 页写入的密钥会立即生效，即使某个 `.env` 里还留着更旧的密钥。没有存储任何东西时这两层仍会参与解析，`describe()` 会把来源报告为 `project-env` 或 `user-env` 且 `writable: true`——存入一个密钥就会取代它们成为生效来源。

在产品 CLI（命令行界面）下，解析读取的是启动器冻结的[环境快照](../../util/launch-environment/README.zh.md)而不是 `process.env`：只有快照才说得清某个值来自启动 shell 还是来自某个文件。并非由产品 CLI 启动的组合只有继承环境这一层，这让嵌入方保持它们原有的语义。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | `<harness home>/.credentials.yaml` | 凭据文档位置。 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | `path` 缺省时使用的 harness home。 |
| `watch` | `true` | 热发布外部编辑。 |
| `debounceMs` | `100` | watcher 写入稳定窗口。 |
| `protection` | `platform` | `platform` 在 Windows 上以当前用户 DPAPI 加密受管文档，在其他平台使用仅属主可读的明文；`plain` 在所有平台明确保留 YAML 表示。 |

## 文档本身

逻辑文档是带版本的 YAML，每个键空间一个分节，除此之外别无他物：

```yaml
version: 1

refs:
  DEEPSEEK_API_KEY: sk-…
  OPENAI_API_KEY: sk-…

records:
  llm-pi-ai/openai-codex:
    kind: grant
    payload:                    # written verbatim; this provider does not interpret it
      type: oauth
      access: eyJhbGciOi…
      refresh: rft_9f8e7d…
      expires: 1786000000000
  llm-pi-ai/amazon-bedrock:
    kind: api-key               # environment values, no key: this route uses an AWS profile
    env:
      AWS_PROFILE: prod
  llm-pi-ai/amazon-bedrock-dev:
    kind: api-key               # neither: the owner confirmed the ambient credential chain
```

默认使用 `protection: platform` 时，Windows 会把完整 YAML 文本放入带版本的 JSON 封套，其 `payload` 是当前用户 DPAPI blob；文件中不再能直接读出凭据名称或值。Windows 第一次启动并遇到现有明文文档时，会先验证内容、执行能够识别的内部布局迁移，再在写锁下以受保护封套原子替换原文件。损坏的 blob，或从另一用户／机器复制来的 blob，会让激活明确失败，绝不会被当成空存储。其他平台仍使用仅属主可读的 YAML 表示；`protection: plain` 是为已经在部署层负责加密的 Windows 环境提供的显式退路。

该文档只存放凭据，因此任何偏离都是拒绝，而不是跳过某个条目——被静默忽略的键读起来就是「我存进去的凭据没有生效」。非 mapping 的根、未知的顶层键、在其空间中不可寻址的键、类型不符的值、空字符串、未知的记录标签或字段、重复键以及格式错误的 YAML 全部失败：启动时明确报错，运行期热重载则告警并保留最后可用快照。

`grant` 的 payload 必须能经受 JSON 往返，读写两个方向都强制。YAML 能拼写出 JSON 没有的值——`.inf`、别名环——拥有者也可能递来 `Date` 或 `bigint`；无论哪种，存储都选择拒绝，而不是存下一个自己无法逐字读回的东西。

发布前的旧布局是没有 `version` 的扁平 mapping。启动时若能精确识别它——可寻址名称对非空字符串标量、且没有文档指令——就在写锁下原地升级：原有各行逐字下沉到 `refs:` 之下，值、注释与拼写逐字节保留。其余任何扁平形态都会被指名拒绝，并给出条目数与唯一需要做的编辑（`version: 1`，条目下沉到 `refs:`）——绝不当作空存储读过去，否则它会以第一次请求认证失败的形式出现，而不是在加载时。热重载从不迁移：运行中被恢复出来的扁平文档只会保住上一份完好快照，直到下次启动。

写入是对解密后已解析的文档打补丁而不是重建，因此注释与所有未触及条目的排版都会保留。直接位于某条目上方的注释属于该条目的注解，会随它一起删除。每次写入都先在 [`dsh-atomic-write`](../../util/atomic-write/README.zh.md) 的跨进程写锁下重读并解密文档、把此前未观察到的一切发布出去，再执行保护并在仅属主可访问（`0700`）的目录下以 `0600` 权限原子提交——因此并发写入者、或落在 watcher 防抖窗口内的外部编辑会被并入，而不是被覆盖。磁盘上已经无法解密或解析的文档会让写入失败，而不是覆盖提供方读不懂的内容。

任何字符串值都能往返，包括多行值，因此不会再有条目因为缺少可用引号样式而不可写。空的存储值等于不存在（seam 规则）——这也正是文档中的空字符串被直接拒绝的原因：`unset` 删除键，而不是把它置空。

## 权限

提供方以 `0700` 创建目录，以 `0600` 创建或原子替换文档。它对*读取*同样守住这条界线：在 POSIX 上，只要文档带有任何 group 或 other 权限位，就会在解析其内容之前失败——启动时与每次 reload 都检查——并在错误里给出 `chmod 600` 的修复命令。Windows 没有可检查的 mode，因此在那里跳过该检查而不是伪造它；当前用户 DPAPI 会阻止另一 Windows 帐户或另一台机器解密复制出去的文件。

## 热重载

外部编辑在快照**整体替换**后按变更引用逐个发布 `credentials/reference-updated`——磁盘上删掉的条目绝不在内存滞留。在 Chokidar 打开目标之前，提供方会对层级最深的现有祖先路径执行 realpath 解析，再拼回缺失的后缀；文件访问和诊断仍使用配置路径，从而避免 Windows 混用 8.3 别名与 libuv 的长格式事件路径。提供方自己的写入按存储内容识别，只发布属于该次提交的一个事件。运行期文档不可读、无法解密或无效时保留最后可用快照并告警；文件不存在即空存储；启动时遇到同类失败则明确报错。在 Windows 保护模式下，运行期出现的明文替换会保持无效，直到重启能够在写锁下验证并迁移它。

<a id="security-boundary"></a>

## 安全边界

在 Windows 上，默认文档只含绑定到当前用户与机器的 DPAPI 密文，因此直接打开或复制文件不会暴露凭据名称或值。这是静态存储保护，**不是对所有同用户进程的隔离**：已经以该 Windows 用户运行的进程可以调用 DPAPI，而工具进程也使用该身份。在 POSIX 上，`0700` 目录中的 `0600` 能挡住其他 OS 用户，但同一用户仍能读到明文。任何表面都不会把解析后的文档路径交给模型，也不会把 provider 管理的值载入进程环境——这与用户的普通环境层 `$DSH_HOME/.env` 不同（见 [app-boot 的 Harness home 各层](../../boot/app-boot/README.zh.md#profiles)）。

必须让 provider 密钥远离已经以自身帐户执行的任意代码时，部署需要独立的最小权限身份或凭据 broker；文件权限与当前用户 DPAPI 都不能建立这种进程边界。

## 模型体验

经由消费它的 LLM（大语言模型）适配器间接生效：存储的值为适配器向提供方发出的请求授权，所有模型可见内容均由适配器负责。

#### KV Cache 影响

无直接失效；凭据绝不进入请求前缀。

## 已知限制与暂缓事项

- **同一引用的并发写入是后写胜出**——写锁加读-改-写让并发写入者不会丢掉彼此的条目，但两个写入者编辑同一个引用时仍以较后的写入为准；没有修订检查。
- **当前用户保护仅适用于 Windows**——macOS 与 Linux 仍使用仅属主可读的明文表示；原生 Keychain／Secret Service 后端仍是暂缓事项。
- **DPAPI 不隔离同用户代码**——见[安全边界](#security-boundary)：它防止直接文件泄漏，也阻止跨用户或跨机器解密，但已经以受保护 Windows 用户执行的代码仍可请求 DPAPI 解密 blob。
- **迁移无法清除较早的明文副本**——原子替换会保护当前文档，但此前创建的备份、文件系统快照、日志残留或诊断包仍可能包含旧 YAML；如果先前的明文存储被视为已经暴露，请轮换相应凭据。
- **环境变化不可见**：快照在启动时冻结，因此启动之后 export 的变量既不会进入解析，也不会进入 `describe`；要更换来自环境的凭据需要重启。
- **原子但不具备崩溃持久性**——继承自 `dsh-atomic-write`；存储在启动时重新读取。
