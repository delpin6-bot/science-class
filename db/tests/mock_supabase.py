"""시험 전용 Supabase 흉내 서버: /rest/v1/rpc/<함수> 와 /auth/v1/token 을 PostgreSQL 로 연결.
   실제 Supabase(PostgREST+GoTrue)가 하는 일(역할 전환·JWT sub 전달)을 최소한으로 재현한다."""
import json, os, sys, uuid, psycopg2, psycopg2.extras
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
ANON = "anon-test"
USERS = json.loads(os.environ.get("MOCK_USERS", "{}"))       # {"email": ["pw", "uuid"]}
SESS = {}                                                     # access_token → uuid
db = psycopg2.connect(os.environ["PG_DSN"])
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "apikey, authorization, content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    def reply(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False, default=str).encode()
        self.send_response(code); self.cors(); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def do_POST(self):
        u = urlparse(self.path); body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.headers.get("apikey") != ANON: return self.reply(401, {"message": "Invalid API key"})
        if u.path == "/test/sql" and os.environ.get("MOCK_TEST") == "1":   # 시험 전용: 관리자 권한 조회
            q = db.cursor(); q.execute("RESET ROLE"); q.execute(body["sql"])
            rows = q.fetchall() if q.description else []; db.commit(); return self.reply(200, rows)
        if u.path == "/auth/v1/token":
            g = parse_qs(u.query).get("grant_type", [""])[0]
            if g == "password":
                rec = USERS.get(body.get("email"))
                if not rec or rec[0] != body.get("password"): return self.reply(400, {"error_description": "Invalid login credentials"})
                sub = rec[1]
            elif g == "refresh_token":
                sub = SESS.get(body.get("refresh_token"))
                if not sub: return self.reply(400, {"error_description": "Invalid Refresh Token"})
            else: return self.reply(400, {"error_description": "bad grant"})
            at, rt = "at-" + uuid.uuid4().hex, "rt-" + uuid.uuid4().hex; SESS[at] = sub; SESS[rt] = sub
            return self.reply(200, {"access_token": at, "refresh_token": rt, "expires_in": 3600, "user": {"id": sub, "email": body.get("email", "")}})
        if u.path.startswith("/rest/v1/rpc/"):
            fn = u.path.rsplit("/", 1)[1]
            if not fn.replace("_", "").isalnum(): return self.reply(404, {"message": "not found"})
            bearer = (self.headers.get("Authorization") or "").replace("Bearer ", "")
            role, sub = ("anon", "") if bearer == ANON else (("authenticated", SESS[bearer]) if bearer in SESS else (None, None))
            if not role: return self.reply(401, {"message": "JWT expired or invalid"})
            q = db.cursor()
            try:
                q.execute("select set_config('request.jwt.claim.sub', %s, true)", (sub,)); q.execute(f"SET LOCAL ROLE {role}")
                args = ", ".join(f"{k} => %s" for k in body)
                vals = [psycopg2.extras.Json(v) if isinstance(v, (list, dict)) else v for v in body.values()]
                q.execute(f"select public.{fn}({args})", vals); res = q.fetchone()[0]; db.commit()
                return self.reply(200, res)
            except psycopg2.Error as e:
                db.rollback(); msg = str(e).splitlines()[0]
                return self.reply(403 if "permission denied" in msg else 400, {"message": msg})
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
