# Agent Note: Electron Windows distribution and installed-app updates

Status: implemented

[English](2026-08-22-electron-windows-distribution-and-updates.md) | 中文

## Problem

Electron 应用可以从 checkout 运行，但不能生成 Windows 安装包、携带 release 标识或为已安装应用提供可验证的更新路径。About 页面中的 Git 更新器不能承担该职责，因为已打包应用没有可快进的 Git 工作树。

## Decision

`dsh-electron` 使用 electron-builder 创建 x64 NSIS 安装包，其中包含已生成的主进程树、配置、运行时依赖、随附 Web 前端、应用元数据和 Windows 图标。常规 package 命令始终传递 `--publish never`；受保护、受 tag 约束的 workflow 是唯一签名并上传 release 产物的路径。

electron-builder 只从受保护 workflow 环境中的 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD` 取得 Windows 签名凭据。源配置不包含证书路径或凭据，Windows 更新下载保留 Authenticode 验证。

已安装应用通过 `electron-updater` 使用已配置的 GitHub release。它会在启动时和每六小时检查，通过原生 Electron UI 报告检查/下载/错误状态，并要求一次确认下载、一次确认重启并安装。它禁用自动下载和退出时自动安装。checkout 更新器仍是 Git 工作树的 host/API 实现。

## Alternatives considered

**为已安装应用复用 checkout 更新器。** 它依赖 Git 历史和可快进的工作树，因此不能安全更新已打包应用。

**自动下载并安装更新。** 明确的下载和重启选择让 agent 工作、未保存的用户决定和应用关闭仍由用户控制。

**在 builder 配置中保留签名字段。** 仅用环境变量提供凭据，避免证书位置和密码进入源代码、日志或已发布 package。

## Testing

更新器单元测试覆盖定期检查、两次批准点、进度和错误。发行版测试固定 NSIS 目标、图标、随附资源、验证设置、release provider 以及不存在签名材料。package smoke 会在禁用更新流量的情况下启动解包后的 Electron 产品，等待真实窗口加载后写入的就绪文件，并观察干净关闭。使用文件是因为 Windows GUI 可执行文件不能可靠地转发标准输出。普通 Node 宿主冒烟测试需要已构建的运行时依赖，因此仅源码测试通道会跳过它。Electron 的生成目录不包含源码映射和声明映射，使 npm tarball 满足 release 归档策略。

## Consequences

Windows 获得可复现的未签名 package 和受保护的已签名 release 路径，同时不改变 checkout 更新。真实更新通道的证明仍需要受信任的证书和已发布的已签名 release；本次仓库变更有意不创建它们。
