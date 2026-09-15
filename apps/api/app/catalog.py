ROWS = [
 ('csi300','沪深 300','000300','A 股','1.000300'),('sse','上证指数','000001','A 股','1.000001'),
 ('sz','深证成指','399001','A 股','0.399001'),('cyb','创业板指','399006','A 股','0.399006'),
 ('csi500','中证 500','000905','A 股','1.000905'),('star50','科创 50','000688','A 股','1.000688'),
 ('hsi','恒生指数','HSI','港股','100.HSI'),('hstech','恒生科技','HSTECH','港股','124.HSTECH'),
 ('hscei','恒生国企','HSCEI','港股','100.HSCEI'),('sp500','标普 500','SPX','美股','100.SPX'),
 ('nasdaq','纳斯达克综合','IXIC','美股','100.NDX'),('dow','道琼斯工业','DJI','美股','100.DJIA'),
 ('csi-dividend','中证红利','000922','A 股','1.000922'),('sse-dividend','上证红利','000015','A 股','1.000015'),
 ('dividend-lowvol','中证红利低波动','H30269','A 股',None),('dividend-lowvol100','中证红利低波动 100','930955','A 股',None),
 ('hsi-dividend','恒生高股息率','HSHDYI','港股',None),('sp-dividend','标普 500 红利贵族','SPDAUDP','美股',None),
 ('dow-dividend100','道琼斯美国红利 100','DJUSDIV','美股',None),
]
# NASDAQ composite is IXIC, never substitute the Nasdaq-100 (NDX).
ROWS[10] = ('nasdaq','纳斯达克综合','IXIC','美股',None)
INDICES = [dict(id=r[0],name=r[1],code=r[2],market=r[3],category='红利' if n>=12 else '宽基',provider_symbol=r[4]) for n,r in enumerate(ROWS)]
BY_ID = {i['id']: i for i in INDICES}
TENCENT_SYMBOLS = {
 'csi300':'sh000300','sse':'sh000001','sz':'sz399001','cyb':'sz399006','csi500':'sh000905','star50':'sh000688',
 'hsi':'hkHSI','hstech':'hkHSTECH','hscei':'hkHSCEI','sp500':'usINX','nasdaq':'usIXIC','dow':'usDJI',
 'csi-dividend':'sh000922','sse-dividend':'sh000015','dividend-lowvol100':'sh930955',
 'hsi-dividend':'hkHSHDYI','sp-dividend':'usSPDAUDP','dow-dividend100':'usDJUSDIV'
}
PRODUCTS = {'510300':'沪深300 ETF','510500':'中证500 ETF','159915':'创业板 ETF','510880':'红利 ETF','515180':'中证红利 ETF','512890':'红利低波 ETF'}
