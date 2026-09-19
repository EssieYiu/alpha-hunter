# 第一轮集成接口

前缀 `/api`。无应用鉴权，同源使用。前端通过 Vite 代理到后端。后端核心负责人负责进一步落实并在此记录差异，变更即时通知前端与 Agent 负责人。

- `GET /health`：状态。
- `GET /indices`：指数对象数组，至少 `id,name,code,market`。
- `GET /indices/{id}/bars?interval=day&years=10&indicators=MA,RSI`：`{bars:[{time,open,high,low,close,volume}],indicators,provider,as_of,unavailable_reason}`。interval 为 minute/day/week/month；years 为 1–20（分时忽略）；indicators 为 MA/EMA/BOLL/MACD/RSI/KDJ 的逗号分隔子集；time 为 Unix 秒；缺失返回空数组和原因。
- `GET /watchlist`：指数 ID 数组；`PUT /watchlist`：`{ids:[]}`。
- `GET /account`：`{cash,positions:[],ledger:[]}`；`POST /trades`：幂等键、ticker、side、quantity、price、fee。金额字符串。
- `GET /strategies`：策略数组；`POST /strategies` 与 `PUT /strategies/{id}`：`{name,type,period,fast,slow,lower,upper,description}`，与原型字段一致，返回 `id,version` 及配置。
- `POST /code-strategies` 与 `PUT /code-strategies/{id}`：`{name,type:"CODE",period,lookback,source,description}`。`source` 定义继承 `StrategyBase` 的 `CustomStrategy` 并实现 `on_bar(self, history)`，格式见 `docs/code-strategies.md`。`GET /strategies` 同时列出模板和代码策略。
- `POST /backtests`：`{strategy_id,index_id,start,end,capital,fee,slippage}`，费率输入按百分数；返回带 `id,status` 的任务。`GET /backtests/{id}` 查询状态与结果，结果包含策略快照、指标、净值/基准、交易。
- `GET /conversations`、`POST /conversations`、`GET /conversations/{id}`：持久历史。`POST /conversations/{id}/messages`：`{message,model,base_url,api_key,context?}`，一期 JSON 回答与工具记录可先集成，SSE 后续补齐。context 可携带 backtest_id / index_id；Key 不持久化。

禁止在正式 API 不通时静默回退演示数据。接口未完成时前端显示不可用原因。
