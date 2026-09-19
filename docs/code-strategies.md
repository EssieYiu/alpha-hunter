# 自定义代码策略契约

代码策略由使用者在「策略管理 → 代码策略」中编写并保存。系统保存代码文本及版本；回测时读取当前版本，和行情一起冻结在结果快照中。Agent 的 `create_strategy` 工具仍只创建 MA / EMA / RSI 参数策略，不能提交代码。

## 必须实现的类与方法

```python
class CustomStrategy(StrategyBase):
    def on_bar(self, history):
        if len(history) < 21:
            return Signal.HOLD

        closes = [bar.close for bar in history]
        short_now = sum(closes[-5:]) / 5
        long_now = sum(closes[-20:]) / 20
        short_prev = sum(closes[-6:-1]) / 5
        long_prev = sum(closes[-21:-1]) / 20
        if short_prev <= long_prev and short_now > long_now:
            return Signal.BUY
        if short_prev >= long_prev and short_now < long_now:
            return Signal.SELL
        return Signal.HOLD
```

必须且只能定义一个顶层类 `CustomStrategy`，直接继承 `StrategyBase`，实现同步方法 `on_bar(self, history)`。每个已完成的日 / 周 / 月 K 线收盘后调用一次。`history` 是只包含截至当前已完成 K 线的不可变序列；元素是只读 `Bar`，字段为 `time` / `session_date`（周期首个交易日的 Unix 秒 / 日期）、`end_time` / `end_session_date`（周期最后一个交易日的 Unix 秒 / 日期）、`open/high/low/close`（浮点数）、`volume`（浮点数或 `None`）。日线的首末交易日相同。不会向策略传入后续行情、现金或持仓。对象可以在 `self` 中保存状态，但一次回测只实例化一次；请保证相同输入产生相同信号。

返回值必须是 `Signal.BUY`、`Signal.SELL` 或 `Signal.HOLD`。买卖信号分别请求全仓买入或清仓；空仓时卖出、持仓时买入会被引擎忽略。信号在本周期收盘形成，下一期**开盘**按滑点和手续费成交。预热区间的信号不会形成回测持仓，回测从空仓开始；最后一根 K 线的信号没有下一期开盘时不会成交。策略无法直接下单、改变费用或访问账户流水。

代码无需 `import`，运行环境提供 `StrategyBase`、`Bar`、`Signal`、`math` 和有限的常用 Python 内置函数。导入模块、访问下划线开头的属性，以及 `open`、`eval`、`exec` 等函数会被拒绝。代码在单独的 Python 子进程中运行，超时 20 秒；Linux 进程还有限制 CPU 时间、地址空间与文件输出。此约束用于个人可信代码的故障隔离，**不是安全沙箱**；不要提交第三方或未经检查的代码。当前部署仅面向单人、loopback / SSH 隧道访问，不应开放给不可信用户。

## 数据如何进入回测

`POST /api/code-strategies` 创建，`PUT /api/code-strategies/{id}` 修改。请求示例：

```json
{
  "name": "双均线示例",
  "type": "CODE",
  "period": "day",
  "lookback": 100,
  "source": "class CustomStrategy(StrategyBase):\n    def on_bar(self, history):\n        return Signal.HOLD",
  "description": "示例"
}
```

`lookback` 范围 2–500，用于向行情服务请求回测开始日期以前的预热数据；实际可用根数取决于供应商。策略应自行处理 `history` 长度不足。回测仍调用 `POST /api/backtests`，提交 `strategy_id`、`index_id`、起止日期、初始资金、手续费和滑点。系统只使用指数目录中的真实供应商历史，缺失时报告不可用，不补合成行情。

回测服务按策略周期调用 `get_bars`，把每根已完成 K 线依次传给 `on_bar` 形成信号，再由统一引擎处理成交、现金、净值、基准和回撤。周/月回测会额外查询结束日期之后的行情，仅用于确认最后一个周期是否收盘；预热查询的首个周期也会排除，以免使用不完整周期。传给策略及保存在快照中的序列不会包含结束日期之后的 K 线。无法确认完成的末尾周期会被排除并提示。净值点标在周期末日，成交仍标在下一周期开盘日。结果保留策略代码和版本、请求参数、原始行情快照及 SHA-256 哈希、数据供应商和引擎版本。编辑策略会产生新版本，不会改写旧回测。

当前仍是单标的、只做多、全仓 / 空仓、指数点位理论组合，允许分数份额；不是可直接交易的 ETF 成交回测。运行同步完成，每次最多 6000 根 K 线。
