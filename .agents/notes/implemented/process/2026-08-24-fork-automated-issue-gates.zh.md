# Agent Note: Fork 与自动化 Issue 门禁

Status: implemented

[English](2026-08-24-fork-automated-issue-gates.md) | 中文

## 问题

Issue lifecycle 与 policy workflow 会在仓库 fork 的 Dependabot pull request 上运行。Lifecycle 尝试创建规范组织的 GitHub App token，但 fork 和 Dependabot workflow 上下文不携带这些 secret。Policy 随后使用 fork 本地 pull request 编号查询规范仓库。这些确定性的配置失败会把无关的依赖更新标成红色。

这些 workflow 管理单一规范组织的 Project 和 Issue policy。Fork 无法正确执行这些写入，而自动化 pull request 本就不属于人工 review policy 的强制范围。

## 决策

两个 job 仍出现在每个已订阅事件中，但 Project token、修改和 pull-request 验证步骤只允许在规范 `deepseek-harness/deepseek-harness` 仓库运行。同一批步骤会跳过作者类型为 `Bot` 或 `App` 的 pull request。Checkout 仍会成功，因此跳过管理工作不会成为失败的依赖检查。

## 考虑过的替代方案

**把 GitHub App 凭据复制到 fork 或 Dependabot secret。** Fork 不拥有规范 Project；扩大可写凭据的范围会授予与依赖验证无关的权限。

**针对 `github.repository` 运行 policy。** 这会把 policy 所有者从配置的规范 Project 改为任意 fork 元数据，并且 lifecycle 写入仍没有对应的组织 Project。

**完全禁用 workflow。** 规范仓库中的人工 pull request 仍需要现有 Issue policy 和事件驱动的 Project lifecycle。

## 验证

Workflow 配置测试要求两个管理步骤同时携带规范仓库和自动化作者门禁。现有事件订阅与规范仓库人工 review 行为保持不变。

## 后果

Dependabot pull request 和 fork 副本不再因为无法获得规范 Project 凭据或匹配的上游 pull request 编号而失败。规范仓库中的人工 pull request 仍保留既定的读写 policy 检查。
