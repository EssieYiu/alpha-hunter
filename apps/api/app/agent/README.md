# Agent 子系统

入口 `app.agent.router.router`，由主应用挂载到 `/api`。会话与工具记录在 PostgreSQL 共用 SQLAlchemy Base 中持久化；Key 不建表，仅随当次请求调用兼容 `/chat/completions` 服务。

服务器环境变量 `AGENT_ALLOWED_BASE_URLS` 为逗号分隔的**精确 base URL**（默认 `https://api.openai.com/v1`）。自定义服务先加入此配置；禁止 URL 用户名、密码、query、fragment，不跟随重定向，不使用代理环境变量。浏览器的 Key 也必须只放内存。

`POST /conversations/{id}/messages` 返回完整会话及 `run_status: completed`。错误以 detail 返回，同时保存本轮已执行工具与失败说明，刷新会话即可查看。回复采用 JSON，尚未实现 SSE。最多 5 次模型请求、8 个工具调用；历史最多 24 条并限长。同轮相同策略创建调用复用结果；同会话使用数据库租约拒绝并发生成，进程意外终止后 5 分钟可重试。

工具调用 `app.services` / `app.market` 的统一领域函数，包括指数目录、行情、策略列表、创建策略、回测快照查询。不包含持仓变更、任意代码、任意 URL 工具。研究策略和保存策略由模型根据用户意图选择，不额外强制草稿批准流程。

验证：在 `apps/api` 运行 `.venv/Scripts/python.exe -m pytest app/agent/tests`。测试客户端只用于确定性测试，线上没有模板/假模型回退。测试隔离 SQLite 仅验证组件行为，正式集成仍需 PostgreSQL。真实模型工具兼容性需要配置用户服务及 Key 后在线核验。
