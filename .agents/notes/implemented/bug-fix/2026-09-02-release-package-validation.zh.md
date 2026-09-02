# Agent Note: Release package validation and desktop preset discovery

Status: implemented

[English](2026-09-02-release-package-validation.md) | 中文

## Problem

远程包遗漏了其已发布运行时代码导入的注册表辅助文件。Electron 相对于源码模块解析随附预设，编译到 `lib/types` 后该路径会指向错误目录。仓库依赖检查还遗漏了设备测试入口，并将通过配置加载的插件视为未使用依赖。

## Decision

远程包的 manifest 发布 `lib/registry-*.js`。Electron 在源码和安装布局中都从自引用包 manifest 解析 `config/agent-presets`。其普通 Node 已构建宿主冒烟测试会在报告就绪前读取真实预设列表。

Knip 将 Android 设备脚本、独立原生通道协议声明、Electron 打包声明以及 Firecrawl e2e 测试列为入口。Electron 使用与 CLI 相同的 scope 依赖豁免，因为 Cordis 配置会加载其插件；Cordis 配置和运行时闭包门禁仍会校验这些依赖。Android 保留由原生 Capacitor manifest 注册的 `@capacitor/app`。未使用的库依赖，以及指向不存在的 Firebase 脚本和 `desktop/` 目录的根 desktop 命令被移除；应用自身的 Electron 命令仍是权威入口。

vendor-rescope 校验器保留 Electron 的 `cordis` 预设标识符，并使用当前精确编辑锚点，不修改 vendored 源码。

shell-command 包为生成的 Typert 运行时保留 `zod`，尽管其手写源码没有导入该依赖。已构建宿主启动会验证这项生成代码依赖。

## Alternatives considered

移除通过配置加载的依赖会破坏打包后的启动。从当前工作目录解析预设会使安装行为取决于可执行文件的启动方式。全面禁用依赖或发布检查会掩盖缺失的运行时文件。

## Validation

已构建包不变量和运行时闭包门禁检查远程包发布内容。Electron 宿主冒烟测试要求存在随附的 `code`、`cordis`、`minimal` 和 `standard` 预设，然后校验提供的 Web 外壳和正常关闭。Knip 和 vendor-rescope 门禁检查完整源码清单。

## Consequences

打包后的宿主保留其预设列表和远程注册表实现。构建 Windows Electron 发行版仍需要原生编译工具链；Android APK 构建不验证该桌面工具链。
