from alembic import context
from app.db import Base,engine
from app import models
from app.agent import router

with engine.connect() as connection:
    context.configure(connection=connection,target_metadata=Base.metadata)
    with context.begin_transaction():context.run_migrations()
