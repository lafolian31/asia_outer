import { useState, type FormEvent } from "react";
import { Sprout, ArrowRight, LockKeyhole } from "lucide-react";
import { db, rpc } from "../lib/api";
import { readableError } from "../lib/utils.js";
export function Auth() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <div className="auth-story">
        <div className="brand">
          <Sprout /> 함께그린
        </div>
        <span className="eyebrow">함께 가꾸고, 함께 기록해요</span>
        <h1>
          오늘의 작은 기록이
          <br />
          내일의 농장을 만듭니다.
        </h1>
        <p>
          계절의 계획부터 하루의 작업까지.
          <br />
          우리 농장의 이야기를 한곳에 모으세요.
        </p>
        <FarmArt />
        <small>한 농장, 여러 사람, 하나의 기록.</small>
      </div>
      <div className="auth-form">
        <div className="lock-icon">
          <LockKeyhole size={27} />
        </div>
        <h2>우리 농장에 들어가기</h2>
        <p className="muted">초대받은 개인 계정으로 로그인해 주세요.</p>
        <form onSubmit={login}>
          <label>
            이메일
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "로그인 중…" : "로그인"}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="auth-note">
          처음 이용하시나요?
          <br />
          농장 관리자에게 개인 계정과 초대 코드를 요청하세요.
          <br />
          비밀번호를 잊은 경우 서비스 소유자에게 재설정을 요청하세요.
        </p>
      </div>
    </main>
  );
}
export function Join({ onJoined }: { onJoined: () => Promise<void> }) {
  const [name, setName] = useState(""),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="join">
      <Sprout size={42} />
      <h1>농장 참여 승인이 필요해요</h1>
      <p className="muted">
        관리자에게 받은 초대 코드를 입력하세요.
        <br />
        이미 참여했던 계정은 관리자에게 접근 복구를 요청해 주세요.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await rpc("accept_invitation", {
              p_token: token.trim(),
              p_name: name,
            });
            await onJoined();
          } catch (err) {
            setError(readableError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          표시 이름
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          초대 코드
          <input
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
        </label>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <button className="primary wide" disabled={busy}>
          농장 참여하기
        </button>
      </form>
      <button className="text-button" onClick={() => db.auth.signOut()}>
        로그아웃
      </button>
    </main>
  );
}
export function FarmArt() {
  return (
    <svg
      className="farm-art"
      viewBox="0 0 480 260"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="358" cy="66" r="31" fill="#EBCB78" />
      <path d="M0 171Q105 105 218 163T480 156V260H0Z" fill="#DCE7CB" />
      <path d="M0 204Q110 132 265 193T480 183V260H0Z" fill="#B8CCA3" />
      <path d="M0 240Q160 148 480 237V260H0Z" fill="#809F78" />
      <path
        d="M65 260Q138 215 247 212M167 260Q205 230 298 218M292 260Q312 240 362 232M413 260L420 244"
        stroke="#DCE7CB"
        strokeWidth="6"
      />
      <path d="M133 155V103L190 71 247 103V161" fill="#F8F4E5" />
      <path
        d="M119 108L190 64 261 108"
        stroke="#55775B"
        strokeWidth="13"
        strokeLinecap="round"
      />
      <path d="M176 158V120H204V162" fill="#B9926D" />
      <path d="M144 115H161V134H144Z M219 115H236V134H219Z" fill="#A6C1B2" />
      <path
        d="M345 178V112M345 145Q312 141 316 115Q343 111 345 145M345 131Q376 129 376 102Q346 103 345 131"
        stroke="#537A54"
        strokeWidth="5"
        fill="#759C68"
      />
      <path
        d="M88 190V148M88 174Q64 170 65 151Q88 150 88 174M88 164Q110 163 113 144Q88 144 88 164"
        stroke="#537A54"
        strokeWidth="4"
        fill="#759C68"
      />
    </svg>
  );
}
