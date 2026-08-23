# Agent Note: 脚本与 gate 运行器支持二进制 pnpm 可执行文件

Status: implemented

[English](2026-08-23-pnpm-binary-invocation.md) | 中文

## Problem

当 pnpm 以编译后的二进制可执行文件形式安装（例如在 Windows 上通过 Scoop 或独立 `@pnpm/exe` 安装的 `pnpm.exe`）时，Node 会将 `process.env.npm_execpath` 设置为该二进制文件的路径。诸如 `scripts/build.ts`、`scripts/run-gates.ts`、`scripts/run-web-snapshots.ts` 和 `scripts/coverage-partitions.ts` 等脚本此前假定 `npm_execpath` 始终为 JavaScript 入口，因而尝试运行 `spawn(process.execPath, [npm_execpath, ...args])`。在安装了二进制 pnpm 的系统上执行仓库脚本时，会导致 Node 抛出 `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".exe"` 异常。

## Decision

- **统一 pnpm 调用辅助函数：** 引入 `scripts/pnpm-invocation.ts`，导出 `pnpmInvocation(args, entrypoint?)`。
- **格式检测：** 若入口具有 JavaScript 文件扩展名（`.cjs`、`.js`、`.mjs`、`.ts`），则通过 `process.execPath` 启动以在 Node 中执行脚本，并避免 Windows `.cmd` shell 调用；若入口为原生可执行文件（如 `.exe` 或独立二进制文件），则直接执行，不再以 `process.execPath` 作为命令。
- **仓库脚本适配：** 重构 `scripts/build.ts`、`scripts/run-gates.ts`、`scripts/run-web-snapshots.ts` 和 `scripts/coverage-partitions.ts` 以使用 `pnpmInvocation`。

## Alternatives considered

- **始终通过 `process.execPath` 启动：** 拒绝——当传入原生二进制可执行文件时，Node 会因 `ERR_UNKNOWN_FILE_EXTENSION` 失败。
- **始终从 `PATH` 调用 `pnpm`：** 拒绝——忽略了调用当前脚本的具体包管理器实例，存在使用不兼容全局版本的风险。

## Consequences

无论是在基于 Node 脚本还是独立二进制的 pnpm 安装环境中，仓库的构建、gate 和测试脚本均可在无需 shell 包装器的情况下正常运行。

## Testing

在 `scripts/pnpm-invocation.spec.ts` 中添加了单元测试，覆盖 JavaScript 入口、Windows `.exe` 二进制、独立 Linux/macOS 二进制以及缺失入口的拒绝处理；并验证了 `pnpm run build` 能够干净成功运行。
