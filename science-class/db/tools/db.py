"""DB 연결·스키마 적용·테이블 객체.

- 연결 주소는 환경변수 DATABASE_URL 로 받는다.
  예) postgresql+psycopg2://teacher:비밀번호@localhost:5432/learning
- 스키마의 기준은 schema_postgresql.sql 하나다(CREATE ... IF NOT EXISTS 라 여러 번 실행해도 안전).
- 파이썬 코드는 DB에 실제로 만들어진 테이블을 읽어(reflect) 쓰므로 SQL과 코드가 어긋나지 않는다.
"""
from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

import sqlalchemy as sa

SCHEMA_FILE = Path(__file__).resolve().parent.parent / "schema_postgresql.sql"
TABLES = ["academic_years", "schools", "students", "learning_activities", "import_batches"]
T = SimpleNamespace()          # T.students, T.schools ... (ensure_schema 후 채워짐)
_engines: dict[str, sa.Engine] = {}


def get_engine(url: str | None = None) -> sa.Engine:
    url = url or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL 환경변수가 없습니다. 예: postgresql+psycopg2://user:pw@localhost:5432/learning")
    if url not in _engines:
        _engines[url] = sa.create_engine(url, pool_pre_ping=True, future=True)
    return _engines[url]


def ensure_schema(engine: sa.Engine) -> None:
    """테이블이 없으면 만들고, 테이블 객체를 T 에 채운다."""
    if all(hasattr(T, t) for t in TABLES):
        return
    insp = sa.inspect(engine)
    if not all(insp.has_table(t) for t in TABLES):
        ddl = SCHEMA_FILE.read_text(encoding="utf-8")
        with engine.begin() as conn:
            conn.exec_driver_sql(ddl)
    md = sa.MetaData()
    md.reflect(engine, only=TABLES)
    for t in TABLES:
        setattr(T, t, md.tables[t])
