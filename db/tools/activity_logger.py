"""학습 활동 기록 (4단계 로그 적재).

게임·가상실험·활동지가 끝날 때 한 건씩(또는 묶음으로) 호출한다.
학생은 student_id 로, 또는 (year, school_name, grade, class_no, student_no) 좌석 정보로 지정할 수 있다.

- 중복 방지: client_event_id(UUID)가 같은 기록은 두 번째부터 무시(네트워크 재전송 대비).
- 검증: 활동 유형·백분율 범위·시간 형식. 문제가 있는 기록은 건너뛰고 사유를 돌려준다.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db import get_engine, ensure_schema, T

TYPES = {"game", "simulation", "worksheet", "quiz", "video", "etc"}


def _pct(v, name):
    if v is None:
        return None
    v = float(v)
    if not 0 <= v <= 100:
        raise ValueError(f"{name}는 0~100 사이여야 합니다({v})")
    return round(v, 2)


def _resolve_students(conn, recs: list[dict]) -> dict[tuple, int]:
    """좌석 정보(연도·학교·학년·반·번호) → student_id 를 한 번의 조회로 찾는다."""
    seats = {(r["year"], r["school_name"], r["grade"], r["class_no"], r["student_no"])
             for r in recs if "student_id" not in r}
    if not seats:
        return {}
    y, sc, st = T.academic_years.c, T.schools.c, T.students.c
    q = (sa.select(y.year, sc.school_name, st.grade, st.class_no, st.student_no, st.student_id)
         .select_from(T.students.join(T.schools, sc.school_id == st.school_id)
                                 .join(T.academic_years, y.year_id == sc.year_id))
         .where(sa.tuple_(y.year, sc.school_name, st.grade, st.class_no, st.student_no).in_(list(seats))))
    return {tuple(r[:5]): r[5] for r in conn.execute(q).all()}


def record_activities(records: list[dict], engine: sa.Engine | None = None) -> dict:
    """반환: {'inserted': n, 'duplicates': n, 'rejected': [{'index': i, 'reason': ...}]}"""
    engine = engine or get_engine()
    ensure_schema(engine)
    rejected, rows, idx = [], [], []
    with engine.begin() as conn:
        ids = _resolve_students(conn, records)
        given = {int(r["student_id"]) for r in records if str(r.get("student_id", "")).isdigit()}
        known = set(conn.execute(sa.select(T.students.c.student_id)
                                 .where(T.students.c.student_id.in_(given))).scalars()) if given else set()
        for i, r in enumerate(records):
            try:
                if r.get("student_id") is not None:
                    sid = int(r["student_id"]) if str(r["student_id"]).isdigit() else None
                    sid = sid if sid in known else None           # 존재하는 학생인지 확인
                else:
                    sid = ids.get((r.get("year"), r.get("school_name"), r.get("grade"), r.get("class_no"), r.get("student_no")))
                if not sid:
                    raise ValueError("명단에 없는 학생")
                if r.get("activity_type") not in TYPES:
                    raise ValueError(f"활동 유형 오류({r.get('activity_type')})")
                if not r.get("content_key"):
                    raise ValueError("content_key(콘텐츠 이름) 누락")
                at = r.get("occurred_at") or datetime.now(timezone.utc)
                if isinstance(at, str):
                    at = datetime.fromisoformat(at)
                if at.tzinfo is None:
                    raise ValueError("occurred_at 에 시간대가 없습니다(예: 2024-05-01T10:00:00+09:00)")
                dur = r.get("duration_sec")
                if dur is not None and int(dur) < 0:
                    raise ValueError("duration_sec 음수")
                rows.append({
                    "student_id": sid, "occurred_at": at, "activity_type": r["activity_type"],
                    "content_key": str(r["content_key"])[:80], "unit_name": r.get("unit_name"),
                    "lesson_title": r.get("lesson_title"), "lesson_code": r.get("lesson_code"),
                    "score": r.get("score"), "accuracy_pct": _pct(r.get("accuracy_pct"), "accuracy_pct"),
                    "progress_pct": _pct(r.get("progress_pct"), "progress_pct"),
                    "duration_sec": int(dur) if dur is not None else None,
                    "detail": r.get("detail") or {},
                    "client_event_id": str(uuid.UUID(str(r["client_event_id"]))) if r.get("client_event_id") else str(uuid.uuid4()),
                })
                idx.append(i)
            except (ValueError, TypeError, KeyError) as e:
                rejected.append({"index": i, "reason": str(e)})
        inserted = 0
        ins = lambda vals: len(conn.execute(pg_insert(T.learning_activities).values(vals)
                                            .on_conflict_do_nothing(index_elements=["client_event_id"])
                                            .returning(T.learning_activities.c.activity_id)).all())
        if rows:
            try:
                with conn.begin_nested():                       # 묶음 저장 (빠른 길)
                    inserted = ins(rows)
            except sa.exc.IntegrityError:
                # 묶음 안에 DB가 거부하는 기록이 있으면: 한 건씩 저장해 문제 기록만 걸러낸다
                inserted, kept = 0, 0
                for i, row in zip(idx, rows):
                    try:
                        with conn.begin_nested():
                            inserted += ins([row]); kept += 1
                    except sa.exc.IntegrityError as e:
                        rejected.append({"index": i, "reason": f"DB 거부: {str(e.orig).splitlines()[0][:120]}"})
                rows = rows[:kept] if kept < len(rows) else rows
    return {"inserted": inserted, "duplicates": len(rows) - inserted, "rejected": sorted(rejected, key=lambda x: x["index"])}
