# 反向端口 · Reverse Ports

![Reverse Ports](media/icon.png)

Version 1.0.0 · [GitHub Releases](https://github.com/0use-TE/reverse-ports/releases/latest)

在 VS Code 底部新增一个采用原生“端口”面板布局的标签页，管理 SSH 反向端口转发。

## 使用

1. 在**本机**执行“扩展：从 VSIX 安装”，安装生成的 VSIX，并重载窗口。
2. 打开底部“反向端口”。找不到时，运行命令“反向端口：打开面板”。
3. 空列表点击“转发端口”，已有规则时点击“添加端口”。输入远程端口，例如 `7890`；转发地址可选填 `7897` 或 `127.0.0.1:7897`，留空默认本机同端口，Enter 保存并启动，SSH 主机自动采用当前远程主机（本地窗口回退到 SSH 配置中的首个主机）。
4. 按 Enter 或点击编辑行外保存并启动，Escape 取消。创建时在两个输入框之间点击不会提前保存。端口前的圆点显示连接状态，悬停可查看错误。双击或按 F2 行内编辑端口，运行中的规则保存后会自动重启。
5. 悬停行时，端口列显示修改端口、停止转发图标；转发地址列右侧显示打开终端、复制、修改转发地址图标。停止转发会先关闭隧道，再移除规则。

空列表只显示说明与一个“转发端口”按钮。标签页徽标显示正在运行的转发数量。端口只显示数字；修改本机目标可点击地址旁的编辑图标、双击转发地址或右键选择“更改转发地址”。运行中的规则自动停止、保存并重新连接，停止的规则只保存。修改远程端口后，已有代理终端需重开以使用新变量。

布局保持“端口 / 转发地址 / 正在运行的进程 / 源”四列，没有顶部工具栏、独立表单或常驻说明。当前未探测远程进程，进程列留空；源显示“手动转发”，悬停可查看 SSH 主机。规则存储仍兼容旧版本。

## 终端代理

- 右键某一行，启用“终端代理”：扩展自动启动该隧道，核对远程主机并注入环境后，**自动创建一个新终端**。无需再手动打开，不会因状态刷新或重连反复创建终端。
- 点击行内“打开终端”图标同样会选择该规则、按需启动并打开带代理变量的终端。
- 一次只选一条代理规则，适用于 HTTP／混合代理。取消“终端代理”会移除后续新终端的变量贡献，不会关闭已有终端。
- 地址取规则的**远程端口**。远程 `7890` → 本机 `7897` 时，远程终端使用 `http://127.0.0.1:7890`。
- 自动注入 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 和小写兼容变量，保留原有排除项。普通新终端也可继承；已有终端需要重开。
- 仅在隧道已连接、当前窗口是匹配的 Remote SSH 工作区且已打开远程文件夹时启用。别名通过本机 `ssh -G` 解析用户、主机和 SSH 端口进行比对。无法匹配时提示原因，不会在其他主机打开终端。
- 停止/断线后暂停后续注入，重连成功后恢复变量贡献；不会自动反复打开终端。窗口重载后仍需手动启动隧道。
- API 按工作区注入，因此同一远程窗口中**显式创建的本地终端也可能继承**变量。行内终端按钮使用远程 URI，确保打开匹配主机的远程终端。普通本地窗口、WSL 和容器窗口不启用自动注入。

复制按钮或右键“复制三行变量”可直接取得：

```bash
export HTTP_PROXY=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890
export HTTPS_PROXY=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890
export NO_PROXY="localhost,127.0.0.1,::1${NO_PROXY:+,$NO_PROXY}${no_proxy:+,$no_proxy}"; export no_proxy="$NO_PROXY"
```

变量只影响读取它们的程序，不自动代理已启动进程、系统服务或容器。复制命令适用于远程 Linux 的 sh/Bash。

## 认证与设置

- 扩展固定在本机 UI 扩展宿主运行，使用本机 OpenSSH，与微软 Remote SSH 的连接独立。
- 支持现有 SSH 密钥、Agent、SSH config 和 ProxyJump。暂不支持密码输入弹窗；先在本机终端确认同一别名可以通过密钥登录，并核验主机指纹。
- 本机用户设置可指定 `reversePorts.sshPath`、`reversePorts.sshConfigFile`。
- 仅绑定远程 `127.0.0.1`。不会创建远程文件或目录，不修改 `.bashrc`、`/etc`、SSH 服务或 settings.json。
- 为确认转发成功，SSH 远程命令只执行 `printf` 和 `cat`；限制远程命令的账户可能无法使用。
- 配置保存在本机扩展 globalState，代理选择保存在当前工作区 workspaceState；环境变量集合不持久化。
- 环境检查、原始日志、停止全部等操作保留在命令面板，不占用面板按钮。实际失败仍有通知和悬停详情。
- 中英文自动跟随 VS Code 显示语言。中文使用简体中文，其他语言回退到英文；用户填写的名称和原始 SSH 日志不翻译。

## 开发与测试

```bash
npm install
npm test
npm run test:vscode
npm run package
```

打开源码目录按 F5 调试。`test:vscode` 使用独立 Profile，支持 `TEST_VSCODE_VERSION=1.96.4` 和 `TEST_VSCODE_LOCALE=en/zh-cn`。中文测试需在 `test-results/extensions` 安装与测试版本匹配的微软中文语言包。

`test:server` 需先设置 `TEST_SSH_HOST` 为你自己的 SSH 主机别名；默认临时绑定远程 47891 端口，可用 `TEST_REMOTE_PORT` 修改。测试通过内存中的 Python/sh/curl 命令访问本机服务，不创建远程文件。

## English

Install the VSIX **locally** and open **Reverse Ports** in the bottom panel. The view follows VS Code's Ports layout: Port, Forwarded Address, Running Process, and Origin.

Click **Add Port** to edit a row inline. Enter a remote port and optionally a local port or host:port; a blank destination defaults to the same local port and the SSH host is inherited from the current remote workspace (or the first configured SSH host). The port cell contains edit and stop actions; the address cell contains terminal, copy and destination edit actions. Editing a running rule automatically restarts it; stopped rules remain stopped. Reopen existing proxy terminals after changing the remote port. The empty view shows one explanation and a Forward a Port button; the tab badge counts running forwards. Enter or clicking outside the editing row saves; Escape cancels. Clicking between the two creation inputs does not submit. Double-click a row or press F2 to edit. Hover a row to copy proxy exports, open a terminal, or stop/remove the forwarding rule.

Right-click **Terminal proxy** to select a rule. The extension starts the tunnel as needed and **automatically opens one new remote terminal once the tunnel and environment are ready**. The terminal icon does the same. Repeated state updates or reconnects do not spawn additional terminals. Proxy URLs use the rule's remote listening port, not its local destination port.

New terminals inherit HTTP_PROXY, HTTPS_PROXY, NO_PROXY and lowercase equivalents, preserving existing exclusions. Existing terminals must be reopened. Injection is non-persistent and workspace-scoped; explicitly created local terminals in the same remote workspace may inherit it too. The terminal button opens in the verified remote folder. Ordinary local windows, mismatched hosts, WSL and containers do not receive injection.

Local SSH keys or an agent are required; password prompts are not implemented. No remote files, shell profiles or system settings are modified. Commands for diagnostics and logs remain available in the Command Palette. Chinese/English localization follows VS Code's display language.
