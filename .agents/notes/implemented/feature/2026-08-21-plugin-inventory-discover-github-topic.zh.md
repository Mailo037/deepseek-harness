# Agent Note: 插件列表“发现”视图浏览 GitHub `dsh-plugin` 主题

Status: implemented

[English](2026-08-21-plugin-inventory-discover-github-topic.md) | 中文

## 问题

插件设置标签页仅显示已安装的 Loader 清单。用户无法在应用内找到 `dsh-plugin` GitHub 主题的第三方插件，必须离开产品才能浏览仓库或比较受欢迎程度。

## 决策

`PluginInventorySettingsTab` 现在拥有一个双视图切换器（已安装 | 发现）。已安装目录保持不变。发现视图直接从浏览器发起 GitHub 公开仓库搜索，查询 `topic:dsh-plugin`（`sort=stars&order=desc&per_page=100`）：无 CSP 限制 `connect-src`，且客户端连接包已使用 `globalThis.fetch`。过滤已归档仓库，其余按 `stargazers_count` 降序重新排序，确保客户端拥有排序权。每张卡片是一个链接到仓库的标签（`target="_blank"`、`rel="noreferrer"`），显示完整名称、两行描述、星标数（带装饰性星形图标）和主要编程语言。现有搜索框同时过滤两种视图；切换视图时重置查询。新增 `zh`/`en` 语言键覆盖切换按钮、发现视图状态和卡片标签。加载、错误+重试、空结果和无匹配结果状态与已安装视图保持一致，错误文案不暴露传输细节。

GitHub 返回数据通过最小本地接口（`DiscoveredPlugin`、`GitHubSearchResponse`）消费，仅定义已使用的字段；请求失败或触发速率限制时显示通用失败状态。

## 备选方案

**通过新的 `api-remotes` 远程接口（类似 `pluginInventory.list`）提供主题数据。** 已拒绝，因为 GitHub 搜索 API 是公开、只读且支持 CORS 的；Host 往返会引入远程方法、Host 管线和额外传输状态，仅用于浏览器浏览界面。

**复用 `dsh-web` 搜索/获取能力。** 已拒绝，因为该接口是 Host 上代理的工具表面，而非设置界面的浏览表面，且带有该标签页不需要的提供方配置。

**分页获取整个主题（9,871 个仓库）。** 已拒绝，因为按星标数取前 100 已是浏览界面；分页作为暂缓事项记录，而非在首次实现中增加。

## 后果

插件标签页现在拥有第二个视图，展示按星标数排序的前 100 个 `dsh-plugin` 主题仓库，星标数可见，已归档仓库不显示。浏览器直接发起请求，因此 GitHub 的未认证搜索配额限制了浏览范围；速率限制或网络故障显示通用失败状态并支持重试。`settings-chrome` 端到端测试的金色文件（`apps/web/tests/snapshots/settings-chrome/plugins.expected.md`）现在包含切换按钮，需要重新录制。

## 测试

包测试覆盖视图切换、归档过滤与星标降序排序、两种视图的客户端过滤，以及 GitHub 失败到重试路径；全部 11 个包测试通过。完整仓库构建（`pnpm run build`）通过。