# Agent Note: 自更新为分离的构建与重启直接启动原生 pnpm 可执行文件

Status: implemented

[English](2026-08-25-self-update-native-pnpm-launch.md) | 中文

## Problem

分离的自更新运行器在 `git pull` 与 `pnpm run build` 之后重启 web 宿主。它以 `spawn(plan.node, [plan.pnpmCli, ...])` 启动 pnpm，始终把 `npm_execpath` 当作 Node 脚本。在 Windows 上，独立的 pnpm（`@pnpm/exe`、Scoop shim）会把 `npm_execpath` 设为原生 `pnpm.exe` 二进制，于是经 `node` 运行会抛出 `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".exe"`。每次更新都在构建步骤中止，GUI 提示 "Update failed"，用户无法应用任何发布版本。

## Decision

`packages/host/self-update/src/startup.ts` 在构建命令与重启 spawn 之前，根据计划中的 `pnpmCli` 解析如何运行 pnpm CLI：

- `.exe`、`.cmd` 或 `.bat` 入口是原生可执行文件，直接 spawn。
- 其他入口（`.cjs`/`.js` pnpm shim）仍是 Node 脚本，以 `node <pnpmCli>` 运行。

构建改为 `command(pnpmLaunch.executable, [...pnpmLaunch.prefix, 'run', 'build'], ...)`；重启则 spawn `pnpmLaunch.executable` 并传入 `[...pnpmLaunch.prefix, ...plan.restartArgs.slice(1)]`，去掉交接计划中第 0 项嵌入的 pnpm 入口。

这与仓库脚本在 [pnpm-binary-invocation](2026-08-23-pnpm-binary-invocation.zh.md) 中使用的规则相同，但无法复用该辅助函数：`scripts/` 属于根目录工具，而发布的 `self-update` 包不能跨包边界导入（其 tsconfig 的 `rootDir` 为 `src`）。因此该辅助函数放在拥有运行器的包中。这更新了 [self-update-launcher-restart](../architecture/2026-08-12-self-update-launcher-restart.zh.md) 的机制，此前它对构建与重启都假定 `node <pnpmCli>`。

失败覆盖层的 Issue 按钮也一并调整：它此前使用了未定义的 `--dsw-alias-bg-elevated` token，在深色终端主题下回退为 `#fff`，导致深色标签文字落在白色按钮上。现在改用真实的 `--dsw-alias-button-elevated-fill` 与 `--dsw-alias-button-floating-hover` token，并以 `mark-github` 16px 图标（`packages/client/ui-primitives/src/icons/index.tsx` 中的 `IconGithubMark16`）引导标签，使链接看起来像 GitHub 操作。

## Alternatives considered

**始终从 PATH 启动 pnpm。** 拒绝——它忽略了发起更新的包管理器实例，并可能用到不兼容的全局 pnpm；而分离运行器必须复现宿主所使用的确切构建与重启环境。

**复用 `scripts/pnpm-invocation.ts`。** 拒绝——发布的包不能导入仓库根目录脚本，因此把这套小检测规则重复放到拥有它的运行器中，而非导入。

**保留 `node <pnpmCli>` 并对 `.cmd`/`.exe` shim 特判。** 拒绝——Node 根本无法执行原生可执行文件，因此对它们没有可靠的 `node` 启动路径。

## Consequences

Windows 自更新现在能完成 `pnpm run build` 并重启宿主，而不再在 pnpm 调用处失败；`.cjs` pnpm 路径保持不变。"Update failed" 界面不再由健康的构建触发，其 Issue 按钮在两种主题下都可读。

## Testing

`packages/client/ui-primitives/tests/icons.client.spec.tsx` 覆盖新增的 `IconGithubMark16`。`packages/client/ui-settings-general/tests/applying-update-overlay.client.spec.tsx` 断言失败更新时渲染出带 GitHub 图标的 Issue 链接。`packages/host/self-update/tests/service.spec.ts` 固定了不变的交接计划，检测规则保留了 `.cjs` 脚本的启动路径。
