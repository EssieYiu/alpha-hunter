from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.backtest import simulate
from app.code_strategy import run_signals
from app.db import Base
from app.main import app
from app.market import aggregate
from app.schemas import BacktestInput, CodeStrategyInput
from app import services


SOURCE = '''class CustomStrategy(StrategyBase):
    def on_bar(self, history):
        if len(history) < 3:
            return Signal.HOLD
        if history[-2].close <= history[-3].close and history[-1].close > history[-2].close:
            return Signal.BUY
        if history[-2].close >= history[-3].close and history[-1].close < history[-2].close:
            return Signal.SELL
        return Signal.HOLD
'''


def bars(values):
    return [dict(time=1700000000 + index * 86400,
                 session_date=(date(2024, 1, 1) + timedelta(days=index)).isoformat(),
                 open=str(value + 1), high=str(value + 2), low=str(value - 1),
                 close=str(value), volume=None, is_final=True)
            for index, value in enumerate(values)]


def test_contract_rejects_missing_method_and_import():
    for source in (
        'class CustomStrategy(StrategyBase):\n    pass',
        'import os\n' + SOURCE,
        SOURCE.replace('history[-1].close', 'history[-1].__class__'),
    ):
        with pytest.raises(ValidationError):
            CodeStrategyInput(name='invalid', source=source)


def test_code_strategy_api_reports_contract_error():
    response = TestClient(app).post('/api/code-strategies', json={
        'name': 'invalid', 'source': 'class CustomStrategy(StrategyBase):\n    pass',
    })
    assert response.status_code == 422
    assert 'on_bar' in response.json()['detail']


def test_code_strategy_next_open_and_no_future():
    market = bars([8, 7, 6, 9, 10, 5, 4])
    config = CodeStrategyInput(name='turn', source=SOURCE).model_dump()
    signals = run_signals(SOURCE, market)
    assert signals == ['HOLD', 'HOLD', 'HOLD', 'BUY', 'HOLD', 'SELL', 'HOLD']
    full = simulate(market, config, 1000, 0, 0, '2024-01-01', '2024-01-07', signals)
    assert [(trade['side'], trade['time']) for trade in full['trades']] == [
        ('buy', market[4]['time']), ('sell', market[6]['time'])]
    prefix = market[:5]
    prefix_result = simulate(prefix, config, 1000, 0, 0, '2024-01-01', '2024-01-07',
                             run_signals(SOURCE, prefix))
    assert prefix_result['equity'] == full['equity'][:5]


def test_unfinished_bar_is_not_passed_to_strategy():
    market = bars([8, 7, 6, 9, 10])
    market[3]['is_final'] = False
    assert run_signals(SOURCE, market)[3] == 'HOLD'
    assert simulate(market, {'type': 'CODE'}, 1000, 0, 0,
                    '2024-01-01', '2024-01-05', run_signals(SOURCE, market))['trades'] == []


def test_invalid_return_is_rejected():
    source = SOURCE.replace('return Signal.HOLD', 'return "HOLD"')
    with pytest.raises(ValueError, match='必须返回'):
        run_signals(source, bars([8, 7, 6]))


def test_weekly_backtest_excludes_truncated_period_and_future_bars():
    daily = [bar for bar in bars([10 + index for index in range(19)])
             if date.fromisoformat(bar['session_date']).weekday() < 5]
    daily.insert(0, {**daily[0], 'time': daily[0]['time']-3*86400,
                     'session_date': '2023-12-29'})
    weekly = aggregate(daily, 'week')
    selected, warning = services.completed_backtest_bars(weekly, 'week', date(2024, 1, 10))
    assert warning
    assert [bar['end_session_date'] for bar in selected] == ['2024-01-05']
    assert all(bar['end_session_date'] <= '2024-01-10' for bar in selected)
    selected_friday, warning_friday = services.completed_backtest_bars(
        weekly, 'week', date(2024, 1, 12))
    assert not warning_friday
    assert [bar['end_session_date'] for bar in selected_friday] == [
        '2024-01-05', '2024-01-12']
    result = simulate(selected_friday, {'type': 'CODE'}, 1000, 0, 0,
                      '2024-01-01', '2024-01-12', ['BUY', 'HOLD'])
    assert result['equity'][0]['time'] == selected_friday[0]['end_time']
    assert result['trades'][0]['time'] == selected_friday[1]['time']


def test_monthly_backtest_excludes_truncated_period():
    daily = [bar for bar in bars([10 + index for index in range(70)])
             if date.fromisoformat(bar['session_date']).weekday() < 5]
    daily.insert(0, {**daily[0], 'time': daily[0]['time']-3*86400,
                     'session_date': '2023-12-29'})
    monthly = aggregate(daily, 'month')
    selected, warning = services.completed_backtest_bars(monthly, 'month', date(2024, 2, 15))
    assert warning
    assert [bar['end_session_date'] for bar in selected] == ['2024-01-31']
    selected_full, warning_full = services.completed_backtest_bars(monthly, 'month', date(2024, 2, 29))
    assert not warning_full
    assert [bar['end_session_date'] for bar in selected_full] == ['2024-01-31', '2024-02-29']


def test_saved_code_strategy_uses_market_and_freezes_result(monkeypatch):
    market = bars([8, 7, 6, 9, 10, 5, 4])
    monkeypatch.setattr(services, 'get_bars', lambda *args, **kwargs: {
        'bars': market, 'provider': 'test provider', 'as_of': '2024-01-07T00:00:00Z',
        'unavailable_reason': None,
    })
    engine = create_engine('sqlite+pysqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        created = services.create_code_strategy(db, CodeStrategyInput(name='turn', source=SOURCE))
        run = services.run_backtest(db, BacktestInput(
            strategy_id=created['id'], index_id='csi300',
            start=date(2024, 1, 1), end=date(2024, 1, 7)))
        assert run['status'] == 'completed'
        assert run['result']['provider'] == 'test provider'
        assert run['result']['strategy_snapshot']['source'] == SOURCE.strip()
        assert len(run['result']['data_hash']) == 64
        assert len(run['result']['trades']) == 2
        edited = services.update_code_strategy(
            db, created['id'], CodeStrategyInput(name='changed', source=SOURCE))
        assert edited['version'] == 2
        assert services.get_backtest(db, run['id'])['result']['strategy_snapshot']['name'] == 'turn'
    engine.dispose()
