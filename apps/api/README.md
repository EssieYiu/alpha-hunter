# Alpha Hunter API

Python 3.12；`pip install -r requirements.lock`。配置 `DATABASE_URL=postgresql+psycopg://...` 后，在此目录运行 `alembic upgrade head`，随后 `uvicorn app.main:app --host 127.0.0.1 --port 8000`。

`python -m pytest tests app/agent/tests -q` 运行确定性测试。`tests/test_postgres.py` 必须设置指向独立空测试数据库的 `TEST_DATABASE_URL`；测试事务最终回滚。它不能指向生产库。`python probe_market.py` 为单独在线供应商探测。

## 已实现与边界

- PostgreSQL 持久化自选、策略不可变版本、模拟人民币 ETF 账户流水、会话、回测快照。初始现金 100000 CNY，无初始持仓。期初/调整持仓是显式调整流水，不修改现金。
- 模拟成交要求幂等键，账户行锁串行化账本写入，Decimal 费用与现金，拒绝超卖。仅目录内 ETF，不接券商。
- 日/周/月 MA、EMA、RSI 理论指数回测；完成周期收盘信号、下一期开盘成交，分数份额，全仓/空仓，不强制末期平仓。费率输入为百分数。同步执行，上限6000根；本轮没有 RQ worker/取消重试。
- MA 用简单平均，EMA 前 N 点平均初始化，RSI Wilder 平滑且横盘50，BOLL总体标准差，MACD柱为2倍DIF减DEA，KDJ初始50。
- 腾讯证券公开端点作为 A/H 指数主研究适配，支持当日分时、最长 20 年日线及服务端聚合周/月；标普 500、纳斯达克综合和道琼斯工业的历史使用 Yahoo Finance 明确指数代码，分时仍使用腾讯。东方财富备用默认关闭，可用 `EASTMONEY_FALLBACK=true` 显式启用。部分红利指数可能只有目录或无历史返回。未连接授权数据源，**不承诺19项真实行情覆盖或十分钟延迟验收通过**。行情新鲜度明确 `unverified`，日期标签不是可信实时报价时间。
- Agent 接真实兼容模型端点；Key按请求使用，不持久化。允许域名通过配置设置；没有Key时明确提示，不以模板假装模型回答。

正式数据库迁移命令必须在服务启动前执行。默认不自动创建生产数据库，不执行破坏性 downgrade。首迁移创建全部模型，后续结构变更需新增显式Alembic版本。

公开数据适配依据：https://akshare.akfamily.xyz/data/index/index.html （东方财富指数历史字段）。接口属于候选研究源，需逐标的对照发行方和交易日历核验。
