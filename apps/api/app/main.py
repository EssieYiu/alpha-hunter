from datetime import date,timedelta
from fastapi import FastAPI,Depends,HTTPException,Query,Request
from pydantic import BaseModel,Field
from sqlalchemy import text
from .db import get_db
from .catalog import INDICES, BY_ID, PRODUCTS
from .models import Setting,Strategy
from .schemas import StrategyInput,CodeStrategyInput,TradeInput,AdjustmentInput,BacktestInput
from . import services
from .market import get_bars
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

app=FastAPI(title='Alpha Hunter API',version='0.1.0')

@app.exception_handler(RequestValidationError)
def validation_error(request:Request,exc:RequestValidationError):
    if request.url.path.startswith('/api/code-strategies'):
        messages=[str(item.get('msg','参数不合法'))[:300] for item in exc.errors()]
        return JSONResponse(status_code=422,content={'detail':'；'.join(messages[:3])})
    return JSONResponse(status_code=422,content={'detail':'请求参数不合法，请检查字段类型、范围和必填项'})

@app.get('/api/health')
def health(db=Depends(get_db)):
    db.execute(text('SELECT 1'));return {'status':'ok','version':'0.1.0'}
@app.get('/api/indices')
def indices():return INDICES
@app.get('/api/products')
def products():return [{'ticker':t,'name':n,'currency':'CNY'} for t,n in PRODUCTS.items()]
@app.get('/api/indices/{id}/bars')
def bars(id:str,interval:str='day',years:int=Query(default=10,ge=1,le=20),indicators:str='MA'):
    groups=[group for group in indicators.split(',') if group]
    allowed={'MA','EMA','BOLL','MACD','RSI','KDJ'}
    if any(group not in allowed for group in groups):raise HTTPException(422,'不支持的指标分组')
    start=None if interval=='minute' else date.today()-timedelta(days=round(years*365.25))
    return get_bars(id,interval,start=start,indicator_groups=groups)
@app.get('/api/watchlist')
def watchlist(db=Depends(get_db)):
    r=db.get(Setting,'watchlist');return r.value['ids'] if r else []
class WatchInput(BaseModel):ids:list[str]=Field(max_length=100)
@app.put('/api/watchlist')
def set_watchlist(payload:WatchInput,db=Depends(get_db)):
    if any(i not in BY_ID for i in payload.ids):raise HTTPException(422,'指数不存在')
    row=db.get(Setting,'watchlist')
    if row is None:row=Setting(key='watchlist');db.add(row)
    row.value={'ids':list(dict.fromkeys(payload.ids))};db.commit();return row.value['ids']
@app.get('/api/account')
def account(db=Depends(get_db)):return services.get_account(db)
@app.post('/api/trades')
def trade(payload:TradeInput,db=Depends(get_db)):return services.execute_trade(db,payload)
@app.post('/api/account/adjustments')
def adjust(payload:AdjustmentInput,db=Depends(get_db)):return services.adjust_position(db,payload)
@app.get('/api/strategies')
def strategies(db=Depends(get_db)):return services.list_strategies(db)
@app.post('/api/strategies')
def create(payload:StrategyInput,db=Depends(get_db)):return services.create_strategy(db,payload)
@app.post('/api/code-strategies')
def create_code(payload:CodeStrategyInput,db=Depends(get_db)):return services.create_code_strategy(db,payload)
@app.put('/api/code-strategies/{id}')
def update_code(id:str,payload:CodeStrategyInput,db=Depends(get_db)):return services.update_code_strategy(db,id,payload)
@app.put('/api/strategies/{id}')
def update(id:str,payload:StrategyInput,db=Depends(get_db)):return services.update_strategy(db,id,payload)
@app.delete('/api/strategies/{id}')
def delete(id:str,db=Depends(get_db)):
    row=db.get(Strategy,id)
    if not row:raise HTTPException(404,'策略不存在')
    db.delete(row);db.commit();return {'deleted':True}
@app.post('/api/backtests')
def run(payload:BacktestInput,db=Depends(get_db)):return services.run_backtest(db,payload)
@app.get('/api/backtests/{id}')
def result(id:str,db=Depends(get_db)):return services.get_backtest(db,id)

from .agent.router import router as agent_router
app.include_router(agent_router,prefix='/api')
