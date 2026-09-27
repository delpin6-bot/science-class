"""모니터링 조회: 특정 연도·학교 학생들의 최근 7일 활동과 평균 진도율.

  python monitor.py --year 2024 --school 원덕중학교
  python monitor.py --year 2024 --school 원덕중학교 --as-of "2024-05-10 18:00+09" --excel 주간보고.xlsx
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import sqlalchemy as sa

from db import get_engine, ensure_schema

SQL_FILE = Path(__file__).resolve().parent.parent / "monitoring_queries.sql"


def _load_queries() -> dict[str, str]:
    """monitoring_queries.sql 을 [Q1], [Q2] 표시 기준으로 나눈다."""
    text = SQL_FILE.read_text(encoding="utf-8")
    parts = re.split(r"^-- \[(Q\d)\].*$", text, flags=re.M)
    return {parts[i]: parts[i + 1].strip().rstrip(";") for i in range(1, len(parts), 2)}


def weekly_report(year: int, school: str, as_of: datetime | None = None,
                  engine: sa.Engine | None = None, tz: str = "Asia/Seoul") -> tuple[pd.DataFrame, pd.DataFrame]:
    engine = engine or get_engine()
    ensure_schema(engine)
    q = _load_queries()
    params = {"year": year, "school_name": school, "as_of": as_of or datetime.now(timezone.utc), "tz": tz}
    with engine.connect() as conn:
        students = pd.read_sql(sa.text(q["Q1"]), conn, params=params)
        classes = pd.read_sql(sa.text(q["Q2"]), conn, params=params)
    return students, classes


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="학생 학습 활동 주간 모니터링")
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--school", required=True)
    ap.add_argument("--as-of", help="기준 시각(기본: 지금). 예: '2024-05-10 18:00+09'")
    ap.add_argument("--excel", help="결과를 엑셀로 저장할 경로")
    a = ap.parse_args(argv)
    try:
        as_of = datetime.fromisoformat(a.as_of) if a.as_of else None
        st, cl = weekly_report(a.year, a.school, as_of)
    except sa.exc.OperationalError as e:
        print(f"❌ DB에 연결할 수 없습니다: {e.orig}"); return 3
    except ValueError as e:
        print(f"❌ 기준 시각 형식 오류: {e}"); return 1
    if st.empty:
        print(f"⚠ {a.year}년 {a.school} 학생이 없습니다. 연도·학교명을 확인하거나 명단을 먼저 올려 주세요."); return 1
    pd.set_option("display.width", 200); pd.set_option("display.max_columns", 20)
    print(f"\n■ {a.year}년 {a.school} 학급 요약\n", cl.to_string(index=False))
    print(f"\n■ 학생별 최근 7일\n", st.drop(columns=["recent_5"]).to_string(index=False))
    if a.excel:
        with pd.ExcelWriter(a.excel) as w:
            cl.to_excel(w, sheet_name="학급 요약", index=False)
            out = st.copy()
            out["recent_5"] = out["recent_5"].astype(str)
            out.to_excel(w, sheet_name="학생별 7일", index=False)
        print(f"\n💾 저장: {a.excel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
