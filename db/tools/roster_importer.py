"""
학생 명단 업로드 → DB 자동 구축 (Python 3.10+ / pandas / SQLAlchemy 2.x / PostgreSQL)

흐름
  1) 파일 읽기      : .xlsx/.xls → read_excel,  .txt/.csv/.tsv → 인코딩(UTF-8/CP949)·구분자 자동 판별
  2) 열 이름 정리   : '학년도/연도/year', '학교명/학교', '학년', '반', '번호', '이름/성명' 등을 표준 이름으로
  3) 행 검증        : 빈 값·숫자 형식·범위 확인 ('3학년', '05번'도 숫자로 인식). 잘못된 행은 건너뛰고 사유 기록
  4) 파일 안 중복   : (연도, 학교, 학년, 반, 번호)가 같은 행은 마지막 행만 사용
  5) DB 반영        : 연도·학교가 없으면 자동 생성 → 학생 Upsert(있으면 갱신, 없으면 추가) → 업로드 이력 기록
     한 파일은 하나의 트랜잭션: 중간에 DB 오류가 나면 전부 되돌리고 '실패' 이력만 남긴다.

사용
  python roster_importer.py 명단.xlsx
  python roster_importer.py 3학년.txt --year 2024 --school 원덕중학교      # 파일에 연도·학교 열이 없을 때
  python roster_importer.py 명단.xlsx --deactivate-missing                  # 명단에서 빠진 학생을 비활성 처리
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db import get_engine, ensure_schema, T


# ───────────────────────────── 예외 ─────────────────────────────
class RosterError(Exception):
    """업로드를 진행할 수 없는 문제(사용자에게 그대로 보여 줄 메시지)."""

class RosterFileError(RosterError):      # 파일 없음·형식·빈 파일·읽기 실패
    pass

class RosterSchemaError(RosterError):    # 필수 열 누락
    pass

class DuplicateFileError(RosterError):   # 이미 반영된 파일
    pass


# ─────────────────────────── 열 이름 표준화 ───────────────────────────
COLUMN_ALIASES = {
    "year":         ["연도", "학년도", "년도", "year", "academic_year"],
    "school_name":  ["학교", "학교명", "school", "school_name"],
    "school_code":  ["학교코드", "표준학교코드", "school_code"],
    "grade":        ["학년", "grade"],
    "class_no":     ["반", "학급", "class", "class_no"],
    "student_no":   ["번호", "출석번호", "번", "no", "number", "student_no"],
    "name":         ["이름", "성명", "학생명", "name", "student_name"],
    "student_code": ["학번", "student_code", "student_id"],
}
REQUIRED = ["year", "school_name", "grade", "class_no", "student_no", "name"]
RANGES = {"year": (2000, 2100), "grade": (1, 6), "class_no": (1, 30), "student_no": (1, 60)}
SEAT_KEY = ["year", "school_name", "grade", "class_no", "student_no"]


def _norm_header(h: str) -> str:
    return re.sub(r"[\s_\-()（）\[\]]", "", str(h)).lower()

_ALIAS_LOOKUP = {_norm_header(a): std for std, al in COLUMN_ALIASES.items() for a in al}


def standardize_columns(df: pd.DataFrame) -> pd.DataFrame:
    rename = {}
    for c in df.columns:
        std = _ALIAS_LOOKUP.get(_norm_header(c))
        if std and std not in rename.values():
            rename[c] = std
    return df.rename(columns=rename)[list(rename.values())]


# ───────────────────────────── 파일 읽기 ─────────────────────────────
def read_roster(path: Path) -> pd.DataFrame:
    """엑셀/텍스트 명단을 문자열 DataFrame으로 읽는다(값 변환은 검증 단계에서)."""
    if not path.exists():
        raise RosterFileError(f"파일을 찾을 수 없습니다: {path}")
    if path.stat().st_size == 0:
        raise RosterFileError(f"빈 파일입니다: {path.name}")
    ext = path.suffix.lower()
    try:
        if ext in (".xlsx", ".xlsm", ".xls"):
            df = pd.read_excel(path, dtype=str, sheet_name=0)
        elif ext in (".txt", ".csv", ".tsv"):
            raw = path.read_bytes()
            for enc in ("utf-8-sig", "cp949", "euc-kr"):     # 한글 윈도우에서 저장한 파일 대비
                try:
                    text = raw.decode(enc); break
                except UnicodeDecodeError:
                    continue
            else:
                raise RosterFileError("글자 인코딩을 알 수 없습니다(UTF-8 또는 CP949로 저장해 주세요).")
            try:
                sep = csv.Sniffer().sniff(text[:4096], delimiters=",\t|;").delimiter
            except csv.Error:
                sep = r"\s+"                                   # 공백으로 줄 맞춘 텍스트
            df = pd.read_csv(io.StringIO(text), sep=sep, dtype=str, engine="python", skipinitialspace=True)
        else:
            raise RosterFileError(f"지원하지 않는 형식입니다: {ext} (xlsx, txt, csv, tsv 가능)")
    except RosterError:
        raise
    except Exception as e:                                     # 손상된 엑셀 등
        raise RosterFileError(f"파일을 읽을 수 없습니다({path.name}): {e}") from e
    df = df.dropna(how="all")
    if df.empty:
        raise RosterFileError(f"학생 행이 없습니다: {path.name}")
    return df


# ───────────────────────────── 검증 ─────────────────────────────
@dataclass
class Prepared:
    rows: list[dict]
    skipped: list[dict] = field(default_factory=list)
    total: int = 0


def _to_int(v) -> int | None:
    """'3', '3학년', '05번', '2024학년도', 3.0 → 정수. 숫자가 없으면 None."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    m = re.search(r"\d+", str(v))
    return int(m.group()) if m else None


def prepare_rows(df: pd.DataFrame, default_year: int | None, default_school: str | None,
                 default_school_code: str | None = None) -> Prepared:
    df = standardize_columns(df)
    if "year" not in df.columns and default_year:
        df["year"] = str(default_year)
    if "school_name" not in df.columns and default_school:
        df["school_name"] = default_school
    if "school_code" not in df.columns and default_school_code:
        df["school_code"] = default_school_code
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        names = {"year": "연도", "school_name": "학교", "grade": "학년", "class_no": "반",
                 "student_no": "번호", "name": "이름"}
        raise RosterSchemaError("필수 열이 없습니다: " + ", ".join(names[m] for m in missing) +
                                " (연도·학교는 --year / --school 로 지정할 수도 있습니다)")

    out, skipped = [], []
    for i, r in enumerate(df.to_dict("records"), start=2):     # 엑셀 기준 행 번호(1행은 머리글)
        row, reason = {}, None
        for k in ("year", "grade", "class_no", "student_no"):
            n = _to_int(r.get(k))
            lo, hi = RANGES[k]
            if n is None:
                raw = r.get(k); shown = "빈칸" if raw is None or (isinstance(raw, float) and pd.isna(raw)) or str(raw).strip() == "" else repr(raw)
                label = {"year": "연도", "grade": "학년", "class_no": "반", "student_no": "번호"}[k]
                reason = f"{label} 값이 비었거나 숫자가 아님({shown})"; break
            if not lo <= n <= hi:
                label = {"year": "연도", "grade": "학년", "class_no": "반", "student_no": "번호"}[k]
                reason = f"{label} 값 범위 오류({n}, 허용 {lo}~{hi})"; break
            row[k] = n
        name = str(r.get("name") or "").strip()
        school = str(r.get("school_name") or "").strip()
        if not reason and not name:
            reason = "이름이 비어 있음"
        if not reason and not school:
            reason = "학교명이 비어 있음"
        if reason:
            skipped.append({"row": i, "reason": reason}); continue
        row["name"] = name[:50]
        row["school_name"] = school[:100]
        sc = r.get("school_code"); row["school_code"] = (str(sc).strip() or None) if sc and not pd.isna(sc) else None
        code = r.get("student_code"); row["student_code"] = (str(code).strip() or None) if code and not pd.isna(code) else None
        row["_row"] = i
        out.append(row)

    # 파일 안 중복(같은 자리): 마지막 행을 쓰고 앞 행은 건너뜀으로 기록
    seen = {}
    for row in out:
        key = tuple(row[k] for k in SEAT_KEY)
        if key in seen:
            skipped.append({"row": seen[key]["_row"], "reason": f"파일 안 중복(→ {row['_row']}행 사용)"})
        seen[key] = row
    return Prepared(rows=list(seen.values()), skipped=sorted(skipped, key=lambda x: x["row"]), total=len(df))


# ───────────────────────────── DB 반영 ─────────────────────────────
@dataclass
class ImportResult:
    import_id: int
    status: str
    total: int
    inserted: int
    updated: int
    skipped: int
    deactivated: int
    errors: list[dict]

    def summary(self) -> str:
        return (f"[{self.status}] 업로드 #{self.import_id}: 전체 {self.total}행 → 추가 {self.inserted}, "
                f"갱신 {self.updated}, 건너뜀 {self.skipped}, 비활성 {self.deactivated}")


def _upsert_years_schools(conn, rows: list[dict]) -> dict[tuple, int]:
    """(연도, 학교명) → school_id. 없는 연도·학교는 만든다."""
    years = sorted({r["year"] for r in rows})
    conn.execute(pg_insert(T.academic_years).values([{"year": y} for y in years])
                 .on_conflict_do_nothing(index_elements=["year"]))
    year_ids = dict(conn.execute(sa.select(T.academic_years.c.year, T.academic_years.c.year_id)
                                 .where(T.academic_years.c.year.in_(years))).all())
    pairs = {}
    for r in rows:
        pairs.setdefault((r["year"], r["school_name"]), r.get("school_code"))
    stmt = pg_insert(T.schools).values([{"year_id": year_ids[y], "school_name": s, "school_code": c}
                                        for (y, s), c in pairs.items()])
    stmt = stmt.on_conflict_do_update(          # 학교코드가 새로 적혀 오면 채워 넣는다
        constraint="uq_school_per_year",
        set_={"school_code": sa.func.coalesce(stmt.excluded.school_code, T.schools.c.school_code)})
    conn.execute(stmt)
    q = (sa.select(T.academic_years.c.year, T.schools.c.school_name, T.schools.c.school_id)
         .join(T.schools, T.schools.c.year_id == T.academic_years.c.year_id)
         .where(T.academic_years.c.year.in_(years)))
    return {(y, s): sid for y, s, sid in conn.execute(q).all()}


def _upsert_students(conn, rows: list[dict], school_ids: dict, import_id: int) -> tuple[int, int]:
    values = [{"school_id": school_ids[(r["year"], r["school_name"])], "grade": r["grade"],
               "class_no": r["class_no"], "student_no": r["student_no"], "name": r["name"],
               "student_code": r["student_code"], "is_active": True, "last_import_id": import_id}
              for r in rows]
    inserted = updated = 0
    for i in range(0, len(values), 1000):                       # 큰 명단은 1,000행씩
        stmt = pg_insert(T.students).values(values[i:i + 1000])
        stmt = stmt.on_conflict_do_update(
            constraint="uq_student_seat",
            set_={"name": stmt.excluded.name,
                  "student_code": sa.func.coalesce(stmt.excluded.student_code, T.students.c.student_code),
                  "is_active": True, "last_import_id": import_id, "updated_at": sa.func.now()},
        ).returning(sa.literal_column("(xmax = 0)").label("inserted"))   # xmax=0 이면 새로 추가된 행
        flags = [r.inserted for r in conn.execute(stmt)]
        inserted += sum(flags); updated += len(flags) - sum(flags)
    return inserted, updated


def _deactivate_missing(conn, rows: list[dict], school_ids: dict) -> int:
    """이번 명단에 없는 학생을 비활성(전학 등). 학습 기록은 지우지 않는다.

    범위는 '이 파일에 들어 있는 학년·반'으로 한정한다. 3학년 1반 명단만 올렸는데
    다른 반 학생까지 빠진 것으로 처리되는 일을 막기 위해서다.
    """
    n = 0
    s = T.students.c
    for key, sid in school_ids.items():
        mine = [r for r in rows if (r["year"], r["school_name"]) == key]
        classes = sorted({(r["grade"], r["class_no"]) for r in mine})
        seats = [(r["grade"], r["class_no"], r["student_no"]) for r in mine]
        if not seats:
            continue
        res = conn.execute(sa.update(T.students)
                           .where(s.school_id == sid, s.is_active,
                                  sa.tuple_(s.grade, s.class_no).in_(classes),
                                  sa.tuple_(s.grade, s.class_no, s.student_no).not_in(seats))
                           .values(is_active=False, updated_at=sa.func.now()))
        n += res.rowcount
    return n


def import_roster(path: str | Path, engine: sa.Engine | None = None, *, year: int | None = None,
                  school: str | None = None, school_code: str | None = None,
                  deactivate_missing: bool = False, force: bool = False) -> ImportResult:
    path = Path(path)
    engine = engine or get_engine()
    ensure_schema(engine)
    df = read_roster(path)                                      # 파일 문제는 여기서 바로 예외
    prep = prepare_rows(df, year, school, school_code)
    if not prep.rows:
        raise RosterFileError(f"저장할 수 있는 학생 행이 없습니다. 사유: {prep.skipped[:5]}")
    sha = hashlib.sha256(path.read_bytes()).hexdigest()

    with engine.begin() as conn:                                # ── 한 파일 = 한 트랜잭션
        if not force:
            done = conn.execute(sa.select(T.import_batches.c.import_id, T.import_batches.c.imported_at)
                                .where(T.import_batches.c.file_sha256 == sha,
                                       T.import_batches.c.status.in_(["success", "partial"]))).first()
            if done:
                raise DuplicateFileError(f"이미 반영된 파일입니다(업로드 #{done.import_id}, {done.imported_at:%Y-%m-%d %H:%M}). "
                                         "다시 반영하려면 --force 를 쓰세요.")
        else:   # 강제 재반영: 예전 성공 이력은 '대체됨'으로 돌려 유일 인덱스와 충돌하지 않게
            conn.execute(sa.update(T.import_batches)
                         .where(T.import_batches.c.file_sha256 == sha,
                                T.import_batches.c.status.in_(["success", "partial"]))
                         .values(status="superseded"))
        import_id = conn.execute(sa.insert(T.import_batches)
                                 .values(file_name=path.name, file_sha256=sha, rows_total=prep.total)
                                 .returning(T.import_batches.c.import_id)).scalar_one()
        try:
            with conn.begin_nested():                            # 학생 반영 부분만 되돌릴 수 있게
                school_ids = _upsert_years_schools(conn, prep.rows)
                ins, upd = _upsert_students(conn, prep.rows, school_ids, import_id)
                deact = _deactivate_missing(conn, prep.rows, school_ids) if deactivate_missing else 0
        except sa.exc.SQLAlchemyError as e:
            err = [{"row": None, "reason": f"DB 오류: {str(e.orig if hasattr(e, 'orig') else e)[:300]}"}]
            conn.execute(sa.update(T.import_batches).where(T.import_batches.c.import_id == import_id)
                         .values(status="failed", errors=err, rows_skipped=prep.total))
            return ImportResult(import_id, "failed", prep.total, 0, 0, prep.total, 0, err)
        status = "partial" if prep.skipped else "success"
        conn.execute(sa.update(T.import_batches).where(T.import_batches.c.import_id == import_id)
                     .values(status=status, rows_inserted=ins, rows_updated=upd,
                             rows_skipped=len(prep.skipped), errors=prep.skipped))
    return ImportResult(import_id, status, prep.total, ins, upd, len(prep.skipped), deact, prep.skipped)


# ───────────────────────────── 명령줄 ─────────────────────────────
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="학생 명단(xlsx/txt/csv)을 DB에 반영합니다.")
    ap.add_argument("files", nargs="+", help="명단 파일(여러 개 가능)")
    ap.add_argument("--year", type=int, help="파일에 연도 열이 없을 때 사용할 연도")
    ap.add_argument("--school", help="파일에 학교 열이 없을 때 사용할 학교명")
    ap.add_argument("--school-code", help="학교코드(선택)")
    ap.add_argument("--deactivate-missing", action="store_true", help="명단에 없는 학생을 비활성 처리")
    ap.add_argument("--force", action="store_true", help="이미 반영한 파일도 다시 반영")
    a = ap.parse_args(argv)
    rc = 0
    for f in a.files:
        try:
            r = import_roster(f, year=a.year, school=a.school, school_code=a.school_code,
                              deactivate_missing=a.deactivate_missing, force=a.force)
            print(f"✅ {Path(f).name}: {r.summary()}")
            for e in r.errors[:10]:
                print(f"   ⚠ {e['row']}행: {e['reason']}")
            if r.status == "failed":
                rc = 2
        except DuplicateFileError as e:
            print(f"⏭  {Path(f).name}: {e}")
        except RosterError as e:
            print(f"❌ {Path(f).name}: {e}"); rc = 1
        except sa.exc.OperationalError as e:
            print(f"❌ DB에 연결할 수 없습니다: {e.orig}"); return 3
    return rc


if __name__ == "__main__":
    sys.exit(main())
