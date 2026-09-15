# 正式开发与并行分工

现有 `dist/` 原型继续由 `node server.cjs` 在本机 4173 提供。正式前端在 `apps/web/`，后端在 `apps/api/`。两者不能混淆：原型中的合成行情与参数映射回测不属于正式数据实现。

## 第一轮

| 负责人 | 文件范围 | 工作 |
| --- | --- | --- |
| 前端子 Agent | apps/web | React 页面、图表、表单、侧栏、接口接入 |
| 后端核心子 Agent | apps/api（除 app/agent） | 数据库、行情、策略、账本、指标、回测 |
| Agent 子 Agent | apps/api/app/agent | 模型客户端、工具调用、持久会话、策略创建、回测解读 |
| 主 Agent | AGENTS.md、contracts、infra、集成文档 | 产品约束、接口协调、容器与验收 |

接口草案见 `contracts/README.md`；后端实际 OpenAPI 是后续类型生成依据。子任务的完成报告不是整个产品已经验收的证明。外部行情与自定义模型须分别记录验证结果。

## 容器集成

正式服务使用独立 Compose 项目及持久数据库，不替换原型。`build.sh` 首次发布会在服务器生成随机数据库密码，APP_PORT 默认 4175，仅绑定服务器 loopback。`AGENT_ALLOWED_BASE_URLS` 指定模型服务的精确 base URL 列表，不填写 Key。

在仓库根目录运行 `bash build.sh`；Windows PowerShell 运行 `.\build.ps1`。脚本上传正式应用，在服务器构建前后端、运行确定性测试和独立 PostgreSQL 集成测试、执行 Alembic 迁移，再更新正式服务。数据库卷和共享环境文件不放在发布目录内，也不会随版本切换删除。

远端访问用 `ssh -N -L 127.0.0.1:4175:127.0.0.1:4175 root@8.216.46.125`，再访问本机 4175。现有 4173 原型和原型发布脚本暂时保留。
