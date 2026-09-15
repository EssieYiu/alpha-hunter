"""Run explicitly with TEST_DATABASE_URL pointing to a disposable PostgreSQL DB."""
import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from fastapi import HTTPException
from app.db import Base
from app.models import Account
from app.schemas import TradeInput,StrategyInput
from app.services import execute_trade,get_account,create_strategy,update_strategy

@pytest.fixture
def db():
    url=os.getenv('TEST_DATABASE_URL')
    if not url:pytest.skip('Requires isolated PostgreSQL TEST_DATABASE_URL')
    assert url.startswith('postgresql')
    engine=create_engine(url)
    Base.metadata.create_all(engine)
    with engine.connect() as connection:
        outer=connection.begin()
        with Session(connection,join_transaction_mode='create_savepoint') as session:
            session.add(Account(id=1,cash=1000));session.commit()
            yield session
        outer.rollback()
    engine.dispose()

def test_cash_idempotency_and_oversell(db):
    payload=TradeInput(idempotency_key='same-key-1',ticker='510300',side='buy',quantity='10',price='5',fee='1')
    assert execute_trade(db,payload)['cash']=='949.00000000'
    assert execute_trade(db,payload)['cash']=='949.00000000'
    with pytest.raises(HTTPException):execute_trade(db,payload.model_copy(update={'quantity':payload.quantity+1}))
    with pytest.raises(HTTPException):execute_trade(db,TradeInput(idempotency_key='sell-key-1',ticker='510300',side='sell',quantity='11',price='5'))
    assert get_account(db)['positions'][0]['quantity']=='10.00000000'

def test_strategy_version(db):
    payload=StrategyInput(name='test',type='MA')
    first=create_strategy(db,payload);second=update_strategy(db,first['id'],payload.model_copy(update={'fast':10}))
    assert first['version']==1 and second['version']==2
