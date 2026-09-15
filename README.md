# Alpha Hunter

中文指数投资工作台。已保留本地交互原型，并新增 React、FastAPI、PostgreSQL 正式开发版本。

Docker 部署到个人服务器：运行 `bash build.sh`；Windows PowerShell 运行 `.\build.ps1`。脚本会构建正式前后端、运行 PostgreSQL 集成测试、执行迁移并更新容器。访问方式、健康检查和回滚见 [部署说明](docs/deployment.md)。

## 原型运行

需要 Node.js，无需安装依赖。在项目目录运行：

```powershell
node server.cjs
```

打开 http://127.0.0.1:4173 。服务仅监听本机。

## 原型功能

- 行情：A 股、港股、美股热门指数，市场过滤、搜索、详情与范围切换。新增红利专题：中证红利、上证红利、中证红利低波动、中证红利低波动 100、恒生高股息率、标普 500 红利贵族、道琼斯美国红利 100；支持图表、自选和回测。名称与代码资料见 [红利指数目录](docs/dividend-indices.md)。
- 技术图表：分时、日/周/月 K 线；可选 MA5/10/20/60/120、EMA12/26、BOLL(20,2)，分时另有量加权均线与昨收线；副图支持成交量、MACD(12,26,9)、RSI14、KDJ(9,3,3)。鼠标移动、触摸或时点滑块查看对应价格和指标值。
- 自选：添加/移除并保存在当前浏览器。
- 模拟持仓：人民币 ETF 期初录入、买卖、现金与成本更新、交易流水；禁止超额卖出和资金不足买入。
- Agent：本地固定逻辑演示工具选择、调用结果和回答；模型设置为界面预览，API Key 仅驻留页面内存，刷新清除，不发送请求。
- 全局 Agent：任意页面右上角小球打开侧栏；与 Agent 页面共享历史会话，可新建、搜索、切换和继续多轮对话。演示逻辑记住本会话的指数或账户上下文，尚未连接真实模型。
- 策略管理：独立页面支持新增、编辑、复制 MA/EMA 双均线和 RSI 区间策略；配置名称、研究周期、参数与说明；保存后可直接进入回测。回测结果保留策略版本快照。
- 回测：参数校验、可变化的示意结果与曲线。

**所有行情、策略信号和回测结果都是合成演示。未接入真实行情、模型、券商和回测引擎。** 交易是手工模拟记账；当前仅支持 CNY。图表是示意数据，不可用于投资分析。

本地数据保存在 `ah-watch-v1` 与 `ah-account-v1` 两个 localStorage 项，清除此站点的浏览器存储可恢复初始示例。API Key 不写入这两个存储项。

会话与自建策略分别保存在 `ah-conversations-v1`、`ah-strategies-v1`，仅在当前浏览器可用；API 配置不会写入其中。存储失败时页面会提示。此前不保存的旧会话无法恢复。分时指数实际值使用粗实线、白色轮廓、浅色面积及末端圆点；均线使用细虚线，参考线使用点线。

## 文件与检查

- `dist/index.html`：页面入口与元信息。
- `dist/app.js`：演示数据、状态、页面渲染与交互。
- `dist/style.css`：桌面及移动布局。
- `dist/market-chart.js` / `dist/market-chart.css`：合成 OHLC、周期聚合、指标计算、技术图表与交互。
- `tests/market-chart.test.cjs`：指标数学、聚合、预热与无未来数据依赖检查。
- `dist/research.js` / `dist/research.css`：全局对话侧栏、会话历史与策略管理。
- `tests/research.test.cjs`：多轮上下文、策略校验与回测快照测试。
- `server.cjs`：本地静态服务。

无编译依赖，`dist` 为直接可运行的静态产物。语法检查：

```powershell
node --check dist/app.js
node --check dist/market-chart.js
node --check server.cjs
node --test tests/market-chart.test.cjs
```

产品与后续接口设计见 [docs/product-plan.md](docs/product-plan.md)。

正式开发技术栈、选型取舍和迁移路径见 [docs/technical-selection.md](docs/technical-selection.md)（2026-09-12 建议稿）。

## 技术图表口径

图表使用稳定的合成数据，不请求外部行情。周、月 OHLC 从同一日线聚合；末根周/月线仍未结束。日历仅跳过周末，未应用真实节假日。分时按市场本地时间生成 1 分钟样例并跳过午休。成交量和分时量加权均线仅作演示，不表示指数可直接交易。

指标先在完整历史上计算再截取显示区间，MA20 在周线上表示 20 周，月线上表示 20 月。EMA 以首个完整周期 SMA 初始化，RSI 使用 Wilder 平滑，BOLL 使用总体标准差，MACD 柱为 2×(DIF−DEA)，KDJ 的 K/D 初始值为 50。数据不足时显示“—”，不补零。当前指标计算独立于旧有固定策略信号和示意回测；它们尚未联动。

公式参考：[TradingView RSI](https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/)、[TradingView Bollinger Bands](https://www.tradingview.com/support/solutions/43000501840-bollinger-bands-bb/)。

- Agent 策略研究：策略管理和新增策略弹窗可打开研究对话。支持 MA / EMA / RSI 模板、多轮修改周期与参数，点击“创建此策略”或明确发送创建指令后保存到本地策略库，并可进入回测。草案和创建记录随历史对话保存。当前仅为固定规则解析与研究流程演示，未连接模型、查询真实数据或验证策略有效性。

- 回测 Agent 解读：运行后点击结果区的‘让 Agent 解读’，在侧栏解释收益、回撤、成本与验证方向；支持多轮追问。历史对话保存独立结果快照，不受后续参数修改或重新运行影响。当前使用本地解释模板，不生成缺失的基准收益或交易指标。
