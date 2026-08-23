# Agent Note: Windows 插件 pnpm 参数绕过命令 shell

Status: implemented

[English](2026-08-22-windows-plugin-pnpm-argv-launch.md) | 中文

## Problem

Windows 的 pnpm 安装通常提供 `pnpm.cmd`。通过命令 shell 启动该包装脚本会使 `dsh plugin` 的 `&`、`|` 等参数成为命令语法，而不是传给 pnpm 的字面值。

## Decision

- **Windows pnpm 启动：** `apps/cli/src/plugin.ts` 查找 PATH 中公开的 pnpm 命令，解析其 shim 旁标准 pnpm 或 Corepack 的 Node 入口，并通过 `process.execPath` 加 `shell: false` 启动该入口。每个传入参数都保持为一个 argv 值。
- **其他主机与未找到 pnpm：** POSIX 继续不经 shell 直接启动 `pnpm`。Windows 入口找不到时，系统会输出既有的 PATH 中 pnpm 诊断并以 127 退出。

## Alternatives considered

- **为 `.cmd` shim 保留 `shell: true`：** 否决——shell 会把 pnpm 参数变为可执行的命令文本。
- **为 `cmd.exe` 引用参数：** 否决——Windows 命令引用不是保留 argv 的接口，且只要参数含 shell 语法，引用规则就可能回归。

## Consequences

CLI 继续支持标准 pnpm 与 Corepack shim，同时将元字符当作字面值处理。不公开任一标准 Node 入口的自定义 Windows pnpm 包装脚本会以 pnpm 安装诊断失败，而不会被执行。

## Testing

构建后的 CLI e2e 测试安装临时 pnpm `.cmd` shim，并用含 `&` 和 Node 命令的参数调用 `dsh plugin`。测试验证 pnpm 入口收到完整的字面参数，且附加命令不会创建文件。另一项 Windows 探针验证缺失的 pnpm 入口会以 127 退出，并输出 pnpm-on-PATH 诊断。
