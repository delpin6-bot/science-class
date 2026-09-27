/* ───────── 학습 기록 DB 연결 설정 ─────────
   Supabase 프로젝트를 만든 뒤 두 값을 채우면 학생 로그인·학습 기록·교사 모니터링이 켜집니다.
   비워 두면(기본) 사이트는 지금처럼 기록 없이 그대로 동작합니다.
   · url      : Supabase → Project Settings → API → Project URL   (예: https://abcd1234.supabase.co)
   · anonKey  : 같은 화면의 anon public key (공개용 키라 GitHub에 올려도 됩니다. service_role 키는 절대 넣지 마세요)
*/
window.KJS_DB_CONFIG = {
  url: "",
  anonKey: "",
  year: 2026,                 // 학생 등록 화면의 기본 학년도
  school: "원덕중학교"         // 학생 등록 화면의 기본 학교 (학교가 하나면 선택칸 없이 고정)
};
