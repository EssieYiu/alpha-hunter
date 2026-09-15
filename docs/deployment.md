# Docker 一键部署

正式应用部署在 `8.216.46.125`，由 Nginx、FastAPI、PostgreSQL 和 Redis 四个容器组成。服务端只监听 `127.0.0.1:4175`，通过 SSH 隧道供本人使用。旧静态原型继续运行在服务器 4173，不参与正式版数据存储。

## 构建与更新

在仓库根目录通过 Git Bash、WSL、Linux 或 macOS 运行 `bash build.sh`；Windows PowerShell 使用 `.\build.ps1`。本地只需要 Git、tar 和 SSH，不需要安装 Docker。脚本上传正式前后端的显式文件清单，不包含 `.env`、API Key、虚拟环境、`node_modules` 或 Git 数据。

服务器发布流程会：

1. 构建带唯一版本标签的 API 和 Web 镜像，并运行前端类型检查及生产构建。
2. 在隔离容器运行后端确定性测试。
3. 在一次性 PostgreSQL 测试数据库运行事务、幂等账本和策略版本集成测试，随后删除测试库。
4. 执行 Alembic 正向迁移，等待全部容器健康，再检查健康接口及 19 项指数目录。
5. 更新 `/opt/alpha-hunter-formal/current`，保留 `previous` 指向上一成功版本。

数据库使用 Compose 项目 `alpha-hunter-formal` 的命名卷，不随发布目录切换或失败清理而删除。首次发布在 `/opt/alpha-hunter-formal/shared/.env` 生成随机数据库密码，权限为 600；API Key 不写入服务器环境文件。

## 访问

在本机保持以下命令运行：

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:4175:127.0.0.1:4175 root@8.216.46.125
```

然后访问 [正式应用](http://127.0.0.1:4175/)。当前开发会话已经建立此隧道；重启电脑后需要重新运行。服务器防火墙无需开放 4175。

## Agent 模型服务

默认只允许 `https://api.openai.com/v1`。如需使用其他兼容服务，编辑服务器共享环境文件中的 `AGENT_ALLOWED_BASE_URLS`，填写逗号分隔的精确 base URL，然后重新运行部署。用户在页面填写的 Key 只随单次消息请求传递，不存入数据库或服务器环境。

## 状态与运维

```bash
current=$(readlink -f /opt/alpha-hunter-formal/current)
version=$(basename "$current")
APP_VERSION="$version" docker compose -p alpha-hunter-formal \
  --project-directory "$current" \
  --env-file /opt/alpha-hunter-formal/shared/.env \
  -f "$current/infra/compose.yaml" ps
curl -f http://127.0.0.1:4175/api/health
```

查看日志时使用同一组 Compose 参数并追加 `logs --tail=100 api web`。回滚只切换应用镜像；Alembic 不自动降级数据库，因此后续迁移必须保持向后兼容，或在发布前制定对应恢复方案。绝对不要使用 `down -v`，它会删除正式数据库卷。

当前回测同步执行，Redis 尚未接入 RQ worker。行情使用腾讯证券公开研究接口，东方财富备用默认关闭；服务器已验证 12 个宽基和中证红利、上证红利的日线，其余红利指数仍可能无历史。页面会展示不可用和 `unverified` 状态；这不表示已满足 10 分钟延迟要求。
