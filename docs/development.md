# 开发与测试

项目使用本机 OpenSSH，扩展运行在 VS Code 的本机 UI 扩展宿主。

```bash
npm ci
npm test
npm run test:vscode
npm run package
```

打开源码目录按 F5 调试。`test:vscode` 使用独立 Profile，可以用 `TEST_VSCODE_VERSION` 指定版本、用 `TEST_VSCODE_LOCALE` 指定语言。中文测试需要安装与测试版本匹配的微软中文语言包。

## 测试实际服务器

设置 `TEST_SSH_HOST` 为你自己的主机别名，再运行 `npm run test:server`。默认临时绑定远程 `47891`，可用 `TEST_REMOTE_PORT` 修改。测试不创建远程文件；会检查 HTTP 反向转发、代理变量、端口冲突和停止后释放端口。

## 测试密码和跳板机

在一个 PowerShell 终端启动临时 SSH 服务：

```powershell
python -m pip install --target test-results/python-auth paramiko
$env:PYTHONPATH = "$PWD/test-results/python-auth"
python test/auth-ssh-fixture.py test-results/auth-fixture
```

在另一个终端运行 `npm run test:auth`。它使用系统 OpenSSH，覆盖直连、单跳、双跳、错误密码、取消和慢输入。结束后，在服务端终端按 Ctrl+C 停止临时服务。

测试只使用回环地址上的测试账号，不改系统 SSH 服务、用户账号或用户的 known_hosts。Paramiko 只用于测试，不进入扩展安装包。

## 介绍网站

网站源码在 `website/`，不需要安装依赖或构建。预览时运行：

```bash
python -m http.server 4173 --directory website
```

浏览器打开 `http://127.0.0.1:4173`。推送网站改动到 `main` 后，`.github/workflows/pages.yml` 会自动部署到 GitHub Pages。也可以在 Actions 页面手动运行。
