# @deepseek-ai/dsh-client-ui-launch

[English](README.md) | 中文

开机自启插件：General 设置中的开关，用于注册或移除应用的登录启动项。Host 侧持有持久的 `ui-launch` 设置命名空间，并把提交的值应用到由运行环境提供的 `launchSettings` 后端；浏览器侧绑定该命名空间并注册偏好行。后端接缝归运行环境所有：web 组合包的 `web-launch-item` 行注册一个 Windows 每用户注册表 Run 键后端，用于重启本检出目录的 web 宿主；Electron 主进程注册其登录项能力；macOS 或 Linux 的 web 宿主不组合任何后端——那里 Host 侧的注入永不触发、命名空间不注册、行也不渲染，绝不会出现一个无法生效的开关。

该偏好为选择性开启——用户从未打开的开关不会注册任何启动项，未被触碰的开关也不会覆盖操作系统里已有的条目。Host 侧先等待后端服务再注册，因此提供方的激活顺序无关紧要。

## Model Experience

无，因为本功能是浏览器侧的偏好行加上 Host 设置注册，其登录项应用不会进入任何模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **应用在操作系统边界属于尽力而为** — 后端通过平台自身的启动机制应用开关（Windows 每用户注册表 Run 键、经 Electron 登录项的 macOS LaunchAgent、Linux XDG autostart）；移除或忽略此类条目的系统策略不在本包控制范围内，也不会被检测。
- **开关不回读操作系统状态** — 行反映的是持久化偏好，而不是启动项的实际回读；用户在应用外删除该条目时，开关保持开启，直到下一次变更被应用。
- **web 表层的 Run 键绑定检出目录** — 注册的命令从后端采样的安装根目录重启 `pnpm dsh --profile web --no-open`；移动或删除检出目录会让条目失效，直到重新应用开关。
