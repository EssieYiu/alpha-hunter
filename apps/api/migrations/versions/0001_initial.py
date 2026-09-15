"""Initial schema."""
from alembic import op
from sqlalchemy import text
from app.db import Base
from app import models
from app.agent import router
revision='0001'
down_revision=None
branch_labels=None
depends_on=None

def upgrade():
    Base.metadata.create_all(op.get_bind())
    op.get_bind().execute(text('INSERT INTO accounts (id,cash) VALUES (1,100000)'))

def downgrade():
    raise RuntimeError('Destructive schema downgrade disabled; restore an explicit backup instead')
