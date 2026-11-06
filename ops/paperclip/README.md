# Paperclip 独立控制台部署

稳定版本和迁移准入见 [协作协议](../../docs/process/paperclip-collaboration.md)。此目录不改变网站 Cloudflare 配置、不自动启动任何开发 agent。

## 运行前

常驻部署需要可持久化磁盘和明确的服务主机。Docker 方案需要 Engine/Compose，使用固定官方镜像 digest、专用数据卷、authenticated/private 和仅 loopback 端口。仅安装当前云工作区实例不证明平台会持续保留进程；长期托管和 HTTPS 尚需确定实际目标。

当前验证主机的 Docker 驱动为 VFS：一次官方镜像展开即耗尽32GB根盘，未创建任何容器/卷。已仅移除这次公共镜像并恢复空间。本机不执行下面 Docker pull/up，改用 Node 24.11+ 和官方 npm 包的独立安装前缀；Docker 文件留作合格常驻主机的部署包。切勿为了本项目擅改宿主存储驱动或执行全局 prune。

## 当前云环境的 npm 隔离安装

固定 `paperclipai@2026.1023.0`，安装前缀 `/workspace/paperclip-runtime/install`，缓存同目录内的 `npm-cache`。userconfig/globalconfig 使用两个不同的新空文件，不能都指向 `/dev/null`（npm 会在配置解析前拒绝重复加载）；不读取既有用户 npm 配置。安装先使用 `--ignore-scripts`，再核查实际运行所需的构建/二进制依赖，不因包已下载就声称服务启动。

外部模型凭据不注入安装环境，保存包版本、官方 dist integrity、安装 lockfile 和校验摘要。数据目录/应用配置须显式指向仓库外，不能让 CLI 默认读取用户 home 或在应用工作树里运行。首次所有者与认证步骤仍按后文要求完成；不会因从 Docker 换为 npm 而跳过。

在仓库外保存一个权限 0600 的环境文件。首次安装可用 Python 标准库生成仅属于新实例的会话签名值，不引用或读取任何既有外部账号凭据：

```python
import os, secrets
from pathlib import Path

path = Path('/workspace/paperclip-runtime/instance.env')
path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write('PAPERCLIP_PORT=3100\n')
    stream.write('BETTER_AUTH_SECRET=' + secrets.token_hex(32) + '\n')
    stream.write('PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=' + secrets.token_hex(32) + '\n')
```

O_EXCL 防止覆写已有配置。不要打印、提交环境文件，也不要把真实值复制进聊天。镜像包含 CLI，不需要在宿主安装包或读取用户 npm 配置。

## 安装和只读检查

以下命令供已核实容量和存储驱动的 Docker 常驻主机，从仓库根目录运行。先确认没有同名容器/数据卷来自另一安装；失败保存事实，不自动再试。当前 VFS 验证主机不运行这组命令。

```sh
docker compose --env-file /workspace/paperclip-runtime/instance.env -f ops/paperclip/compose.yaml config --quiet
docker compose --env-file /workspace/paperclip-runtime/instance.env -f ops/paperclip/compose.yaml pull
docker compose --env-file /workspace/paperclip-runtime/instance.env -f ops/paperclip/compose.yaml up -d --pull never
python3 ops/paperclip/probe.py
```

首次启动需要初始化数据库。健康检查和 probe 只读，不是失败重试或 agent 唤醒。应用日志可能含管理员邀请/认领链接，存仓库外受限目录，公开前必须脱敏。不要使用会输出所有环境值的 `docker inspect` 或 `compose config`；仅查看选定的 State、Mounts、端口及镜像字段。

## 所有者与公网入口

先在受信任访问路径认领实例。全新 authenticated/private 在真实浏览器登录后提供首次认领，第一位完成者获得管理员；不得将未认领实例公开。authenticated/public 使用官方 `auth bootstrap-ceo` 一次性邀请，邀请按私密认证材料处理，不进本仓库或公开记录。

正式开放前需要：用户确定常驻主机、HTTPS 域名和负责的管理员；精确允许的代理/主机名；备份恢复；认证与无权访问验证。Dot 还要求稳定公网 HTTPS 和两个实验开关，配对和测试事件通过后才能接收任务。现有 Compose 不开放这些开关或公网接口；变更另记配置通知并经原权限边界确认。

## 数据与回退

`van-sticker-paperclip-data` 保存数据库、附件、工作区和应用自身密钥。数据库未停止时不能把原始卷文件复制当成一致备份；按该版本官方备份流程生成并验证恢复，备份含敏感数据，放经授权的受限存储。

正常停止当前实例使用 Compose `stop`，数据卷保留。不要使用 `down -v`、`volume rm` 或 prune。首次 `restart: no` 使启动失败可见；常驻服务重启策略只有在健康、停令及 agent 准入验证后另行配置并通知用户。版本升级先做兼容备份和独立验证，不能只切旧镜像运行已升级数据库来声称回滚。

本目录的安装/服务命令与实际开发任务续行、网站生产发版是三个独立范围。
