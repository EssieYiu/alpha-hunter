# Alpha Hunter 技术选型建议

日期：2026-09-12。状态：正式开发前的选型建议；现有原型另已增加 Docker 部署流程，详见 [部署说明](deployment.md)。

业务约束已确认：允许行情延迟不超过 10 分钟；不需要多年分钟历史；本人使用，不实现应用鉴权；服务器 8.216.46.125 使用 Docker 部署，并通过本机 SSH 隧道访问。行情源验收须检查行情时间而非仅检查请求成功；交易时段最新快照超过 10 分钟标记过期，休市时按最近已结束交易时段判断。分钟数据优先当前交易日，先不建设多年分钟存储与分钟回测。

## 1. 结论与适用范围

推荐采用 **React + TypeScript + Vite 前端，FastAPI Python 后端，PostgreSQL 主数据库，Redis + RQ 后台任务**。采用模块化单体：领域服务集中在一个后端项目中，API 和任务进程分别运行、共享业务代码。

以当前六个页面为范围：行情总览、自选、模拟持仓、Agent 助手、策略管理、策略回测；包含全局 Agent 抽屉、会话历史和参数化策略。先落地个人/小规模使用的研究工具、模拟交易与记账。真实券商下单、任意用户代码执行和高频交易不属于这次选型承诺。

当前静态 JS + SVG + localStorage 原型已验证交互；正式开发复用产品设计、样式方向和测试案例，逐模块迁移，实现服务端数据与计算。当前原型没有真实行情、LLM 或回测引擎，不能将其假数据和参数映射算法当作正式实现。

## 2. 技术栈决策表

| 层次 | 推荐选择 | 在本项目的职责 | 取舍 |
| --- | --- | --- | --- |
| 前端 | React + TypeScript + Vite | 六个业务页面、图表组件、全局对话框 | 工作台以私人研究交互为主，SSR/SEO 不是当前需求；路由、数据获取显式配置 |
| 路由 | React Router | 页面 URL、详情、对话 ID、回测 ID | 避免当前全局 page 字符串切换带来的刷新丢位置 |
| 服务端状态 | TanStack Query | 行情、持仓、策略、会话请求与缓存 | 与本地 UI 状态分开，按实体键管理缓存 |
| UI 状态 | Zustand | 抽屉开关、活动会话 ID、按会话隔离的输入草稿 | 不复制一份完整业务数据库到 store |
| 组件与样式 | Tailwind CSS + shadcn/ui，Lucide 图标 | 表格、抽屉、弹窗、表单；沿用现有视觉方向 | 统一可访问交互，不引入第二套完整组件体系 |
| 表单 | React Hook Form + Zod | 交易、策略、模型设置的前端校验 | 后端继续独立校验，前端校验不作为安全边界 |
| 行情图表 | TradingView Lightweight Charts | 分时、K 线、多指标线、成交量与振荡指标副图 | 提供绘图与交互；行情和指标由本项目提供 |
| 后端 | Python + FastAPI + Pydantic | API、行情适配、领域服务、Agent | Python 研究计算生态与异步 I/O 在同一项目衔接 |
| 数据访问 | SQLAlchemy 2.x + Alembic | 数据模型、事务、数据库迁移 | 明确事务边界，避免用 API DTO 直接充当所有数据库实体 |
| 主数据库 | PostgreSQL | 用户、自选、流水、会话、策略版本、行情和回测元数据 | 多进程与事务需求已出现，正式版本直接使用 PostgreSQL |
| 任务与缓存 | Redis + RQ | 行情采集、历史补数、回测任务；短期缓存 | 增加运行组件，但免去自行维护任务队列；持久业务结果仍入 PostgreSQL |
| 指标计算 | NumPy + pandas，独立指标模块 | MA、EMA、BOLL、MACD、RSI、KDJ 与周期聚合 | 一期指标范围有限，集中实现并验证口径 |
| Agent | ModelClient 适配层 + 有界 ReAct 工具循环 | 模型服务切换、工具调用、多轮会话、流式回复 | 一期保持简单；需要复杂流程恢复时再引入 LangGraph |
| 数据接口契约 | REST + OpenAPI；流式事件采用 SSE | Web 与后端契约，生成 TypeScript 类型 | 一期不引入 GraphQL；行情先轮询，不做全量 WebSocket 基建 |
| 交付 | Docker Compose；开发依赖用 pnpm / uv 锁定 | 一套本地/服务器运行配置 | Windows 推荐 WSL2/Docker Linux 任务进程；不要求 Kubernetes |
| 验证 | pytest、Vitest、Testing Library、Playwright | 领域正确性、组件与完整用户流程 | 行情测试使用固定快照，在线供应商探测与确定性测试分开 |

React 官方说明了 Vite 的 SPA 路径及其需要自行补齐路由、数据获取的取舍；本项目通过 React Router 与 TanStack Query 明确承担这些职责。[React 文档](https://react.dev/learn/build-a-react-app-from-scratch)、[TanStack Query 文档](https://tanstack.com/query/latest/docs/framework/react/overview)。FastAPI 提供 Pydantic 集成、流式响应和 API 文档能力，适合作为统一接口层。[FastAPI 文档](https://fastapi.tiangolo.com/features/)

不在方案阶段随意锁定所有包的“最新”小版本。正式建项时选择相互兼容的稳定版本，记录 Node/Python 运行版本，生成 pnpm-lock.yaml 与 uv.lock，并通过最小兼容性测试后锁定。

## 3. 图表与行情

### 图表选 Lightweight Charts

分时用粗实线和面积，指标用细虚线/点线；K 线与 MA/EMA/BOLL 共用价格面板，MACD/RSI/KDJ 使用独立副图与对应量纲。成交量与价格不能放在同一数值轴。在 React 中封装图表生命周期、容器尺寸变化和订阅清理，增量更新最后一根 K 线，避免每次报价重建图表。

该库提供金融图表和多面板能力，但不会替我们提供行情或计算这些指标；使用时遵守其 NOTICE 与 TradingView 链接要求。[项目说明与许可](https://github.com/tradingview/lightweight-charts)、[多面板示例](https://github.com/tradingview/lightweight-charts/blob/master/website/tutorials/how_to/panes.mdx)

ECharts 可作为以后通用统计图表的备选，当前不为少量回测曲线同时引入两套图表引擎。TradingView Advanced Charts 与 Lightweight Charts 是不同产品，不把前者的能力与授权条件默认套用到本方案。

### 数据源采取适配层，供应商按能力验收

框架可以先定，供应商不能仅凭一个包名定下来。推荐：

| 数据范围 | 研究开发候选 | 正式落地前必须确认 |
| --- | --- | --- |
| A 股指数历史日线 | AKShare 对应指数历史接口 | 指数覆盖、起始日期、数据缺失与源站稳定性 |
| A 股盘中分钟线/快照 | AKShare 对应分钟与快照接口 | 可回溯时长、更新时间、请求频率、成交量单位 |
| 港股指数历史/快照 | AKShare 对应港股指数接口 | 每个指数代码、分钟线覆盖、延迟与权限 |
| 美股指数历史 | AKShare 对应接口或 yfinance，做并行验证候选 | 指数本体与 ETF 代理区别、复权与时区口径 |
| 港美股稳定盘中分时 | 能明确覆盖目标指数的授权供应商 | 合同/套餐中的指数覆盖、延迟、历史深度、展示授权与预算 |

AKShare 文档明确说明某些指数分钟接口仅提供当前/近期数据，不能拿它承诺多年一分钟回测。[AKShare 指数文档](https://akshare.akfamily.xyz/data/index/index.html)。yfinance 可用于个人研究候选，其项目也强调上游数据的个人使用范围；不能据此默认获得公开产品的行情分发授权。[yfinance 项目说明](https://github.com/ranaroussi/yfinance)

先建立 capabilities 表：每个供应商、指数支持哪些周期、数据深度、时间戳语义、延迟、量字段口径、调整口径。网页根据实际能力开启图表；缺失功能显示不可用原因，不能以日线插值生成“真实分时”。

统一数据结构：instrument_id、provider、timestamp、session_date、OHLC、volume/amount、volume_unit、interval、is_final、as_of、fetched_at、revision。缺失量字段为 null，不补零；指数没有可信量或均价时关闭相应指标。

行情采集由后端按市场开放时段集中进行，页面不直接请求第三方。初步以 15–60 秒刷新可见指数快照、一分钟粒度分时为目标，最终刷新频率服从源站能力与限流。非交易时段停止高频轮询；多个用户共用行情缓存。

使用 UTC 保存绝对时间、交易所时区确定 session_date，覆盖香港午休、美国夏令时、半日市和休市。exchange_calendars 作为交易日历基础，再与各市场官方日历抽样核对及维护异常日，不把社区日历当作不可出错的事实。[exchange_calendars](https://github.com/gerrymanoim/exchange_calendars)

周/月线由一致的日线口径聚合，并保留未结束状态。盘中未完成 K 线可以供观察，但正式策略信号只使用完成周期。计算指标时先加载预热数据，再截取显示范围。

## 4. 指标、策略与回测共用一套业务逻辑

### 指标计算放后端

原型 JS 指标实现保留为验收样例。正式指标服务统一定义 EMA 初始化、RSI 平滑、MACD 柱倍率、BOLL 标准差、KDJ 初始值、缺失值和预热规则。

行情页面、信号扫描、回测和 Agent 全部调用这套计算模块，避免四份实现产生不同结论。可视图表只接收数值序列。若以后为交互速度增加浏览器预计算，须标记预览状态并以服务端结果为准。

### 策略保存为结构化配置与不可变版本

首期继续支持 MA、EMA、RSI 模板。配置包含模板 ID/版本、研究周期、参数、信号确认规则。Pydantic 负责模板白名单、参数范围和交叉条件校验。名称、描述不作为可执行表达式。

策略实体与策略版本分别建表；编辑产生新版本，回测引用不可变版本。复制产生新的策略 ID。前端表单按模板 schema 展示字段，避免在策略页、回测页分别维护同一份参数。

一期允许用户新增参数化策略，不接受任意 Python/JavaScript。以后要支持代码策略，另加隔离执行环境、资源上限和代码版本管理，不能直接 eval 用户或模型输出。

### 回测选择有限范围的事件驱动实现

推荐先实现本项目需要的**单标的、只做多、全仓/空仓、日/周/月周期**回测核心，配合 NumPy/pandas；不自研通用量化平台。复用指标与策略信号函数，另实现现金、持仓、费用和成交事件。

Backtesting.py 可做外部校对或引擎候选；它能减少基础回测代码，但接入前需要验证执行时点、费用、可交易单位、结果结构以及许可证是否符合产品分发方式。VectorBT 类向量化方案留到大量参数扫描需求明确后评估。[Backtesting.py 文档](https://kernc.github.io/backtesting.py/)

必需规则：

- 周期收盘形成信号，下一可交易时点开盘执行；周/月策略也只能在该周期结束后下单。
- 对指数只展示理论组合回测；ETF 回测使用 ETF 行情、费用与可交易单位，不能用指数点位当作成交价。
- 手续费、滑点、现金约束与末期未平仓估值明确；初期不隐含杠杆、卖空、盘中止损或撮合优先级。
- 行情修订不能改写旧结果。保存输入数据快照/哈希、策略版本、引擎版本、参数、费用模型和运行状态。
- 输出净值、基准、回撤、交易明细、收益统计与有效样本区间；无交易或样本不足时返回不可计算状态。

回测通过 RQ 在独立进程执行，API 创建任务后返回 run_id；前端轮询状态或订阅进度。失败、超时、重试、取消均有状态记录。数据库中的任务记录是业务依据，Redis 是队列/缓存；任务重试用同一 run_id 幂等写入，不能重复记账或重复生成结果。API 建任务后发布队列失败时保留 pending 状态并由补偿机制重投。[RQ 文档](https://python-rq.org/docs/)

RQ 的具体 worker 方式与运行平台有关；正式运行统一使用 Linux 容器。Windows 原生调试若采用 SpawnWorker，先按所选 RQ 版本测试兼容性。[RQ Worker 文档](https://python-rq.org/docs/workers/)

## 5. Agent、侧栏与会话历史

一期选择一个轻量 ReAct 循环：模型返回工具调用 → 参数校验 → 执行业务工具 → 工具结果回传模型 → 输出回复。设置循环次数、工具输出条数、超时和 token 预算。它调用与 HTTP API 相同的领域服务；不必为调用自己的服务绕一层本机 HTTP。

定义 ModelClient 接口，把模型请求协议、模型能力检测与业务工具隔离。首个适配器接支持 tool calling 的兼容模型服务；工具调用、流式回复与错误格式必须单独验证，不能只验证一个普通聊天请求就宣布“兼容”。不提供工具调用能力的模型应提示限制。

先不引入 LangGraph。已有会话历史通过业务表存储即可；未来需要跨进程恢复多步骤任务、人工审核节点或多个 Agent 协作，再利用其 checkpoint 与状态图能力。业务 conversation_id 保持稳定，避免未来迁移影响页面。[LangGraph 持久化文档](https://docs.langchain.com/oss/python/langgraph/persistence)

会话设计：

- conversations：用户、标题、创建/更新时间；messages：顺序、角色、内容、状态；agent_runs：一次回复任务；tool_calls：工具名、参数摘要、结果、耗时与状态。
- 抽屉与完整页面共享 conversation_id 和 TanStack Query 缓存。输入草稿按 conversation_id 保存；抽屉开关不卸载当前业务页面，不重置交易和回测表单。
- 请求明确绑定 conversation_id/run_id。切换会话时，迟到的响应只能更新原会话。同一会话一期仅允许一个生成中的 run。
- 多轮上下文从数据库按序加载，超出预算时使用历史摘要加最近消息，不能无限重发全部聊天记录。摘要有来源范围，不能覆盖原始消息。
- 使用 POST fetch 接收 text/event-stream 格式事件：run_started、text_delta、tool_started、tool_finished、run_finished/error。前端不依赖只能简单 GET 的 EventSource 来提交带正文的聊天请求。
- 一期运行中断后记录 interrupted/failed 和已有输出；用户可以在原会话继续，不自动宣称断点恢复、也不无提示重复调用收费模型。
- Key 默认仅用于当前会话/请求，后端调用后释放，不放日志、消息、Redis 任务载荷或模型上下文。若以后选择“记住 Key”，使用服务端加密存储，主密钥与数据库分开。
- 自定义服务地址采用校验与显式配置的允许范围；本地模型另设部署配置，避免开放任意内网代理。

首批工具：指数目录、行情快照、历史行情、指标、策略信号、自选、持仓、创建回测、查询回测。回测工具受任务额度约束。Agent 不直接修改持仓或下单；后续新增策略的 AI 辅助可先生成结构化草稿，由用户在策略页保存。

一期不需要向量数据库：当前主要是结构化行情/持仓工具查询。等到研报、公告检索成为实际需求，再选 RAG 存储和检索方案。

## 6. 数据库与持仓一致性

正式数据库改为 PostgreSQL，比前期草案的 SQLite 更适合现在的 API、行情采集、回测进程共同访问。SQLite 可以保留为完全离线便携版的候选，但不作为正式集成测试中 PostgreSQL 的替身。

主要表组：

- local_profile、model_connections（无登录与注册）；
- indices、instruments、provider_symbols、market_bars、quote_snapshots；
- watchlists、accounts、ledger_entries、position_projections；
- strategies、strategy_versions、signals；
- conversations、messages、agent_runs、tool_calls；
- backtest_runs、backtest_trades、backtest_equity、data_snapshots。

持仓以不可变流水为依据，持仓表是投影；买卖、费用、现金和持仓同步提交数据库事务。每次交易包含幂等键，通过账户行锁/版本检查防止并发超卖。金额用 NUMERIC/Decimal，前后端传递金额字符串，不能依赖 JavaScript 浮点数维护账本。

每个账户有明确币种；未提供可信汇率时不跨币种汇总。指数与实际产品分表；期初持仓录入与实际买卖有不同流水类型。调整生成冲正/调整记录，不直接改历史交易。

行情按 instrument、interval、timestamp、provider 和必要版本字段建立索引/约束。先用普通 PostgreSQL 表；分钟数据明显增长后再按日期分区。回测不可变输入快照可压缩为 Parquet 文件，第一版使用本地持久卷及元数据校验和，以后换成对象存储。

一期不默认增加 TimescaleDB、ClickHouse 或 DuckDB。是否增加由数据规模、扫描耗时与运维成本决定。Redis 数据丢失不应造成用户账本、策略或会话丢失。

## 7. 进程、部署与工程结构

建议仓库结构（未来开发目标，本次不创建这些目录）：

```text
apps/web/                       React 页面、图表、Agent 抽屉
apps/api/                       FastAPI 路由与组合入口
packages/domain/                行情、持仓、策略、指标、回测、Agent 服务
workers/                        采集与回测任务入口
contracts/                      OpenAPI 与生成的 TypeScript 类型
tests/                          单元、集成、供应商契约、端到端
infra/                          Compose、反向代理、环境变量示例
docs/                           产品方案、ADR、数据源能力矩阵
```

API 与 worker 共享 Python 领域包，不让前端直接访问数据库。开发时 Vite 代理 /api；交付时静态前端与 API 使用同源反向代理，避免不必要的跨域、Cookie 和流式连接问题。先在本地或一台服务器上以 Compose 运行；这是普通 Python 服务与后台进程，不把它们当作现有静态原型的托管能力。

已选择单用户无应用鉴权：服务器端口只绑定 loopback，本机通过 SSH 隧道使用。正式后端沿用该私人入口；不实现登录、注册和多租户权限。未来若改为公网或多用户产品，需要重新设计访问控制，不能直接开放现有无鉴权接口。

结构化日志带 request_id/run_id，不记录 Key；任务失败可追踪，行情新鲜度可观测。备份数据库与快照文件，并测试恢复。CI 执行类型检查、关键领域测试和前端构建；外部真实行情探测不应让普通单元测试随机失败。

## 8. 分期迁移与验收门槛

1. **兼容性与数据 POC**：选 A/港/美各一个指数，验证历史日线、快照、分钟覆盖、时区、延迟；同时验证图表多面板与一个模型的完整工具调用。产出能力矩阵和版本锁定结果。
2. **正式前端与持久化**：React 实现现有交互，建立 FastAPI/PostgreSQL；迁移自选、策略和会话，保留现有原型可查看。localStorage 导入用显式、可重复运行且不重复写入的迁移入口。
3. **行情与指标**：替换合成数据，建设采集缓存和统一计算服务；核验跨时区、休市、缺失数据、周/月聚合及各指标口径。
4. **策略与真实回测**：统一规则函数，完成独立任务进程和不可变快照；测试无未来数据、次期开盘、费用、末期信号、无交易、任务失败重试。
5. **持仓账本与真实 Agent**：交易并发/重复提交/冲正测试；模型工具调用、会话隔离、历史继续、流式错误及 Key 不泄漏验证。

步骤 2 即开始领域骨架与持仓数据模型，步骤 5 是完成与验收，不意味着最后才设计账本。先通过最有不确定性的行情/模型 POC，再投入全量前端重构。

## 9. 已确认业务输入

1. 行情延迟不超过 10 分钟；不需要多年分钟历史。数据源仍需实测三地指数覆盖与延迟，未购买任何付费行情。
2. 本人从本机使用，不做应用鉴权；部署到指定服务器的 Docker，通过 SSH 隧道访问。

正式业务功能仍以个人研究与模拟交易为范围。当前已实施静态原型 Docker 部署脚本；本建议中的 React/FastAPI、真实行情、数据库与后台任务尚未实现。
