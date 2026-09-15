"""Explicit online probe, kept out of deterministic test suite."""
import json
from app.catalog import INDICES
from app.market import get_bars

if __name__=='__main__':
    for index in INDICES:
        for interval in ('day','minute'):
            result=get_bars(index['id'],interval)
            print(json.dumps({'id':index['id'],'interval':interval,'count':len(result['bars']),'as_of':result['as_of'],'freshness':result['freshness'],'unavailable_reason':result['unavailable_reason']},ensure_ascii=True),flush=True)
