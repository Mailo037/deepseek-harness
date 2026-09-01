# Agent Note: Windows DPAPI credential at-rest protection

Status: implemented

[English](2026-08-30-windows-dpapi-credential-at-rest-protection.md) | 中文

## Problem

`credentials-local` 曾把 provider 管理的 API key 与授权 grant 以明文 YAML 保存。仅属主权限能在 POSIX 上阻止其他 OS 帐户打开文档，但 Windows 无法检查等价 ACL；任何备份、诊断包或直接文件读取都会暴露凭据名称和值。Base64 只会改变表示方式，不提供机密性或完整性。

## Decision

`credentials-local` 的 `protection` 默认为 `platform`。在 Windows 上它解析为当前用户 DPAPI：provider 序列化完整的逻辑 YAML 文档，通过维护中的预构建 `@primno/dpapi` N-API binding 保护这些字节，再写入严格、带版本的 JSON 封套；封套只包含保护方法，以及对不透明 DPAPI blob 的 Base64 传输编码。Base64 层只负责传输密文；DPAPI 提供机密性和完整性，并把解密绑定到同一台机器上的同一 Windows 用户。其他平台在实现原生存储之前继续使用仅属主可读的明文表示；`protection: plain` 是显式的部署覆盖。

Windows 第一次激活并遇到明文时，会在现有跨进程写锁下验证内部文档、按需执行能够识别的发布前布局迁移、保护结果并原子替换文件。格式错误的封套、损坏的密文、来自其他用户或机器的 blob、不支持的方法或版本都会让激活失败，而不会变成空存储。运行中的受保护 provider 会拒绝明文替换；重启是唯一迁移点，因此 watcher 事件不能静默降级存储。

解密后的 YAML 在内存中仍是保留注释的编辑模型。每次写入都会在现有锁下重读并解密当前文件，修改一个引用或记录，保护完整结果并原子提交。原始存储封套另行跟踪，用于抑制 watcher 对自身写入的回声。现有优先级、按操作解析、事件、记录 mutation，以及 `0600`／`0700` 行为均保持不变。

这是静态存储保护，不是进程隔离承诺。已经以同一 Windows 用户运行的代码仍可调用 DPAPI，包括拥有任意原生执行能力的 agent 工具进程。若要对同帐户任意代码隐藏密钥，需要独立的最小权限身份或凭据 broker。

## Verification

credentials-local package suite 覆盖明文迁移、存储封套中不存在凭据名称和值、受保护重启、损坏密文拒绝、运行期明文降级拒绝、显式明文配置拒绝既有受保护文档、平台决策，以及全部既有存储行为。Windows 测试执行真实 DPAPI；非 Windows host 保留明文单元路径。

## Alternatives considered

**Base64 或可逆应用编码**——拒绝，因为 decoder 与编码值会同时存在；它既不能阻止泄漏，也不能阻止篡改。

**手写 Koffi `CryptProtectData` 调用表**——拒绝，因为聚焦实现曾在仓库 fork 测试负载下间歇产生无效 blob。维护中的预构建 N-API package 删除了自有 FFI 布局与内存管理代码，同时保留明确的 Windows API 与当前用户 scope。

**只使用 Windows Credential Manager**——本次变更拒绝，因为 credential service 存储的是一份跨引用与不透明授权记录的原子文档，并带有跨进程读改写和枚举语义。把每个字段拆成独立 OS entry 需要第二份持久索引与事务设计；它同样不能隔离同用户任意代码。

**让 `platform` 在 macOS 与 Linux 上失败**——拒绝，因为这会让现有本地 provider 在受支持平台上不可用。它们当前仅属主可读的文件行为会作为限制明确记录，而不会被错误标成已加密。

## Consequences

直接打开或复制默认 Windows credential 文档不再暴露 provider 名称、API key、refresh token 或授权 payload，篡改也会在解密时因认证失败而被拒绝。文档有意绑定到一个 Windows 用户与机器，因此复制到另一帐户或 host 不是凭据迁移机制，管理员重置密码也可能使其无法恢复。替换当前明文文件无法清除先前的备份、快照、日志残留或诊断副本；如果运营方把先前的明文存储视为暴露，就必须轮换这些凭据。原生预构建依赖进入发布运行时闭包，其 no-op 安装脚本由 workspace 供应链策略显式允许。macOS Keychain、Linux Secret Service，以及对同帐户任意代码的隔离不属于本决策。
