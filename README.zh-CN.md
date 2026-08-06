<h1 align="center">QuotaPin for Codex</h1>

<p align="center">
  <strong>不用打开菜单，直接看 Codex 剩余额度。</strong><br>
  QuotaPin 把百分比放进原本的账户栏。
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img alt="Windows 11 已验证" src="https://img.shields.io/badge/Windows_11-已验证-111827?style=flat-square">
  <img alt="数据只在本机" src="https://img.shields.io/badge/数据-只在本机-10b981?style=flat-square">
  <img alt="MIT 许可证" src="https://img.shields.io/badge/许可证-MIT-6366f1?style=flat-square">
</p>

## 快速开始

打开 Windows PowerShell，粘贴：

```powershell
irm https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install.ps1 | iex
```

这条命令默认安装最新稳定版。然后照常打开 Codex；若 Codex 已经在运行，这条命令不会打断它，QuotaPin 会在下次正常启动时接入。需要指定旧版、预发布版或执行回退时，请使用[配置文档](docs/configuration.md#updates-and-recovery-versions)里的完整命令。

更习惯双击安装？[下载 `QuotaPin-1.0.1.exe`](https://github.com/WSL043/QuotaPin-for-Codex/releases/latest/download/QuotaPin-1.0.1.exe) 即可。

<p align="center">
  <img src="assets/screenshots/product-zh-CN.png" width="960" alt="账户菜单未打开时，QuotaPin 已在 Codex 账户栏显示百分之一剩余额度">
</p>

> [!IMPORTANT]
> QuotaPin 是非官方社区项目，与 OpenAI 没有隶属、认可或支持关系。

## 少点一次，少断一次思路

短按账户栏，照常打开 Codex 账户菜单；长按同一行，打开 QuotaPin。再次按下或点面板外即可关闭。原有帮助按钮、头像和用户名都保留。

<details>
<summary>运行要求与首次启动</summary>

- **已经验证：** x64 Windows 11，并已登录 Codex Desktop。
- **尽力兼容：** x64 Windows 10 版本 2004（内部版本 19041）或更新版本。暂不支持 Windows ARM64。
- **权限：** 只安装给当前用户，不需要管理员权限。
- **正在运行的任务：** 安装和更新都不会关闭或重启 Codex；当前进程无法安全接入时，就等下次正常启动。

已经拉取仓库时，可用下面的命令安装；`Restricted` 执行策略也能运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

重新安装或更新会保留视图和偏好。指定版本、回退及配置恢复见[配置说明](docs/configuration.md)。

</details>

## 默认克制，想折腾也有地方

刚安装好时，Codex 原生头像和用户名保持不变，只多一个剩余百分比。

<p align="center">
  <img src="assets/screenshots/states-zh-CN.png" width="900" alt="QuotaPin 的正常、提醒和危险三档颜色，以及可选额度线">
  <br><sub>默认在 30% 进入提醒、10% 进入危险；阈值可以修改。</sub>
</p>

<p align="center">
  <img src="assets/screenshots/examples-zh-CN.png" width="900" alt="QuotaPin 的六种真实组合，包括倒计时、只看状态和调整身份位置">
</p>

百分比、状态圆点、额度线、剩余时间、秒级倒计时、重置日期和重置时间都能单独开关和排序。可选的 Token 模块还能显示这台电脑今天的用量，以及账户累计用量；悬浮信息会给出完整数值，并明确标出“今天”只统计本机。紧凑时间（`4d 8h`）是三种界面语言都能用的通用模块，中文时间（`4天8小时`）则是另一块独立模块。

<p align="center">
  <img src="assets/screenshots/drag-layout.gif" width="405" alt="把 QuotaPin 模块拖到左侧、右侧和中间时，旁边模块自动让位">
  <br><sub>拖到左侧、右侧或中间，旁边的模块会自己让位。</sub>
</p>

- **快速：** 选择额度周期，决定显示什么、放在哪里。
- **自定义：** 调整颜色、阈值、悬浮内容、头像形状、面板明暗和动态效果。
- **代码：** 提供完整且经过校验的配置接口；玩乱了可以重置。

常用搭配可以保存成命名视图，随时切换。

## 只看额度，不看你的任务

QuotaPin 只从本机 Codex 读取剩余额度，不读取任务内容、提示词、Cookie 或账户身份，也不上传使用数据。只有唯一账户栏能够被明确识别时才会显示；位置不确定就保持隐藏。官方 Codex 安装包从不被修改。

详细说明：[配置](docs/configuration.md) · [安全](SECURITY.md) · [隐私](PRIVACY.md) · [架构](docs/architecture.md) · [实测兼容性](docs/compatibility.md)

QuotaPin 一天最多检查一次更新，未经确认不会安装，也不会重启 Codex。无法安全原位接入时，新版本会等到下次正常启动再生效。

## Mac 版还需要真机验收

GitHub Actions 可以构建独立运行的 macOS 开发版，但不能证明它适配当前 Codex、Gatekeeper 和真实账户栏。所需的真机证据与脱敏反馈入口都在 [macOS 移植说明](docs/macos-port.md)里。

## 想法与贡献

先[搜索已有想法](https://github.com/WSL043/QuotaPin-for-Codex/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement+sort%3Areactions-%2B1-desc)，用 👍 投票；没有相同提议时，再[提交新想法](https://github.com/WSL043/QuotaPin-for-Codex/issues/new?template=feature.yml)。提交代码前请先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 卸载

打开 **开始菜单 > QuotaPin > Uninstall QuotaPin**，或者运行：

```powershell
& "$env:LOCALAPPDATA\QuotaPin\unins000.exe"
```

QuotaPin 只移除自己的文件和快捷方式，Codex 不受影响。
