import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Sprout,
  LayoutDashboard,
  BookOpen,
  CalendarDays,
  FolderOpen,
  Settings,
  Plus,
  Search,
  ArrowUpRight,
  ChevronRight,
  RefreshCw,
  LogOut,
  Leaf,
  CheckCircle2,
  Clock3,
  AlertCircle,
  KeyRound,
} from "lucide-react";
import { configured, db, snapshot, exportCsv } from "./lib/api";
import { planStats, readableError, roleLabels, today } from "./lib/utils.js";
import type { Entry, Kind, Member, Snapshot } from "./lib/types";
import { Auth, Join, FarmArt } from "./components/Auth";
import { Editor } from "./components/Editor";
import { Detail } from "./components/Detail";
import { Admin } from "./components/Admin";
import { Password } from "./components/Password";
const navigation = [
  { id: "home", name: "농장 한눈에", icon: LayoutDashboard },
  { id: "log", name: "작업일지", icon: BookOpen },
  { id: "plan", name: "연간 계획·실적", icon: CalendarDays },
  { id: "resource", name: "자료실", icon: FolderOpen },
  { id: "admin", name: "농장 관리", icon: Settings },
];
export default function App() {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null),
    [authReady, setAuthReady] = useState(false),
    [s, setS] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [page, setPage] = useState("home"),
    [editor, setEditor] = useState<{ kind: Kind; entry?: Entry } | null>(null),
    [detail, setDetail] = useState<Entry | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [author, setAuthor] = useState(""),
    [plan, setPlan] = useState(""),
    [year, setYear] = useState(Number(today().slice(0, 4))),
    [month, setMonth] = useState(""),
    [category, setCategory] = useState("");
  const me = s?.members.find((m) => m.user_id === session?.user.id && m.active);
  const writable = !!me && me.role !== "viewer";
  const refresh = useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    try {
      const { data, error } = await db
        .from("members")
        .select("user_id")
        .eq("user_id", session.user.id)
        .eq("active", true);
      if (error) throw error;
      if (!data.length) {
        setS(null);
        setEditor(null);
        setDetail(null);
        return;
      }
      const next = await snapshot();
      setS(next);
      setError("");
    } catch (e) {
      setError(readableError(e));
      throw e;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.user.id]);
  useEffect(() => {
    if (!configured) {
      setAuthReady(true);
      return;
    }
    db.auth.getSession().then(({ data, error }) => {
      setSession(data.session);
      setAuthReady(true);
      if (error) setError(readableError(error));
    });
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setAuthReady(true);
      if (!next) {
        setS(null);
        setDetail(null);
        setEditor(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session) {
      setLoading(true);
      refresh().catch(() => {});
    }
  }, [session?.user.id, refresh]);
  useEffect(() => {
    const active = () => {
      setOnline(navigator.onLine);
      if (session && document.visibilityState === "visible")
        refresh().catch(() => {});
    };
    window.addEventListener("online", active);
    window.addEventListener("offline", active);
    window.addEventListener("focus", active);
    document.addEventListener("visibilitychange", active);
    const timer = setInterval(active, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", active);
      window.removeEventListener("offline", active);
      window.removeEventListener("focus", active);
      document.removeEventListener("visibilitychange", active);
    };
  }, [refresh, session]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 6000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    if (me?.role === "viewer") setEditor(null);
    if (me?.role !== "admin" && page === "admin") setPage("home");
  }, [me?.role, page]);
  function navigate(next: string) {
    setPage(next);
    setQuery("");
    setCategory("");
    setFrom("");
    setTo("");
    setPlan("");
    setAuthor("");
    setMonth("");
  }

  if (!configured)
    return (
      <main className="join">
        <Sprout size={48} />
        <h1>함께그린 연결 준비</h1>
        <p>
          앱 구현은 준비되었습니다. 공동 사용을 시작하려면 무료 Supabase
          프로젝트 연결과 호스팅 배포가 필요합니다.
        </p>
        <div className="inset">
          <p>
            개발자용 README의 연결 순서에 따라 서버를 준비하고
            <br />
            <code>VITE_SUPABASE_URL</code>과 <code>VITE_SUPABASE_ANON_KEY</code>
            를 설정해 주세요.
          </p>
          <p>현재는 농장 기록이 저장되거나 공유되지 않습니다.</p>
        </div>
      </main>
    );
  if (!authReady) return <main className="join">로그인 확인 중…</main>;
  if (!session) return <Auth />;
  if (loading) return <main className="join">농장 기록 불러오는 중…</main>;
  if (!s || !me)
    return (
      <>
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button onClick={() => refresh().catch(() => {})}>다시 연결</button>
          </div>
        )}
        <Join onJoined={refresh} />
      </>
    );
  const active = s.entries.filter((e) => !e.deleted_at);
  const plans = active.filter((e) => e.kind === "plan");
  const yearPlans = plans.filter((e) => e.target_year === year);
  const stats = planStats(
    page === "home"
      ? plans.filter((e) => e.target_year === Number(today().slice(0, 4)))
      : yearPlans,
  );
  const logs = active
    .filter((e) => e.kind === "log")
    .sort(
      (a, b) =>
        (b.work_date || "").localeCompare(a.work_date || "") ||
        b.created_at.localeCompare(a.created_at),
    );
  const overdue = plans.filter(
    (e) => e.end_date! < today() && ["미실행", "진행중"].includes(e.status),
  );
  const upcoming = plans
    .filter(
      (e) => e.end_date! >= today() && ["미실행", "진행중"].includes(e.status),
    )
    .sort((a, b) => a.start_date!.localeCompare(b.start_date!));
  const name = (id: string) =>
    s.members.find((m) => m.user_id === id)?.display_name || "이전 참여자";
  const filtered = active
    .filter((e) => e.kind === page)
    .filter((e) =>
      (e.title + " " + e.body + " " + e.result + " " + e.zone + " " + e.crop)
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .filter((e) => !author || e.author_id === author)
    .filter(
      (e) =>
        page !== "log" ||
        ((!from || e.work_date! >= from) &&
          (!to || e.work_date! <= to) &&
          (!plan || (plan === "none" ? !e.plan_id : e.plan_id === plan))),
    )
    .filter(
      (e) =>
        page !== "plan" ||
        (e.target_year === year &&
          (!month ||
            (e.start_date! <= `${year}-${month}-31` &&
              e.end_date! >= `${year}-${month}-01`))),
    )
    .filter((e) => !category || e.category === category)
    .sort((a, b) =>
      (b.work_date || b.start_date || b.created_at).localeCompare(
        a.work_date || a.start_date || a.created_at,
      ),
    );
  const card = (e: Entry) => (
    <button className="record-card" key={e.id} onClick={() => setDetail(e)}>
      <div className="record-icon">
        {e.kind === "log" ? (
          <BookOpen size={21} />
        ) : e.kind === "plan" ? (
          <CalendarDays size={21} />
        ) : (
          <FolderOpen size={21} />
        )}
      </div>
      <div className="record-main">
        <div className="record-meta">
          {e.work_date || e.start_date || e.created_at.slice(0, 10)}
          <span>·</span>
          {name(e.author_id)}
          {e.kind === "resource" && <span className="tag">{e.category}</span>}
        </div>
        <h3>{e.title}</h3>
        <p>{e.body || "설명이 없습니다."}</p>
        <div className="record-tags">
          {e.zone && <span>{e.zone}</span>}
          {e.crop && <span>{e.crop}</span>}
          {e.kind === "log" && (
            <span>{e.plan_id ? "계획 연결" : "계획 외 작업"}</span>
          )}
          {s.assets.some((a) => a.entry_id === e.id && a.ready) && (
            <span>
              첨부{" "}
              {s.assets.filter((a) => a.entry_id === e.id && a.ready).length}
            </span>
          )}
        </div>
      </div>
      <ChevronRight size={19} />
    </button>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("home");
          }}
        >
          <div className="brand-icon">
            <Sprout size={25} />
          </div>
          함께그린
        </a>
        <div className="farm-selector">
          <Leaf size={17} />
          <div>
            <small>우리의 공동 농장</small>
            <strong>{s.settings.name}</strong>
          </div>
        </div>
        <div className="nav-caption">농장 공간</div>
        <nav>
          {navigation
            .filter((n) => n.id !== "admin" || me.role === "admin")
            .map((n) => (
              <button
                key={n.id}
                className={page === n.id ? "active" : ""}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={20} />
                <span>{n.name}</span>
                {n.id === "log" && <small>{logs.length}</small>}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="free-note">
            <span className="dot" />
            무료 시험 운영<small>함께 쌓이는 농장의 시간</small>
          </div>
          <div className="profile">
            <div className="avatar">{me.display_name.slice(0, 1)}</div>
            <div>
              <strong>{me.display_name}</strong>
              <small>{roleLabels[me.role]}</small>
            </div>
            <button
              className="icon-button"
              aria-label="로그아웃"
              onClick={() => db.auth.signOut()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            우리 농장 <ChevronRight size={14} />
            <span>{navigation.find((n) => n.id === page)?.name}</span>
          </div>
          <div className="top-actions">
            <span className="today-label">
              {new Date().toLocaleDateString("ko-KR", {
                year: "numeric",
                month: "long",
                day: "numeric",
                weekday: "short",
                timeZone: "Asia/Seoul",
              })}
            </span>
            <button
              className="icon-button"
              aria-label="새로고침"
              disabled={refreshing}
              onClick={() => refresh().catch(() => {})}
            >
              <RefreshCw size={18} className={refreshing ? "spin" : ""} />
            </button>
            <button
              className="icon-button"
              aria-label="비밀번호 변경"
              onClick={() => setPasswordOpen(true)}
            >
              <KeyRound size={18} />
            </button>
            <button
              className="mobile-logout icon-button"
              aria-label="로그아웃"
              onClick={() => db.auth.signOut()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="workspace">
          {!online && (
            <p className="alert error" role="alert">
              인터넷 연결이 끊겼습니다. 입력은 유지되지만 서버 저장은 연결 후
              가능합니다.
            </p>
          )}
          {error && (
            <p className="alert error" role="alert">
              {error} · 현재 목록은 최신 상태가 아닐 수 있습니다.
            </p>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === "home"
                  ? "OUR FARM, TOGETHER"
                  : "함께 가꾸는 농장의 기록"}
              </span>
              <h1>
                {page === "home"
                  ? "농장의 오늘을 살펴보세요"
                  : navigation.find((n) => n.id === page)?.name}
              </h1>
              <p>
                {page === "home"
                  ? `${me.display_name} 님, 반갑습니다. 오늘의 일도 함께 기록해 볼까요?`
                  : page === "log"
                    ? "작업의 과정과 결과를 기록하고, 서로의 하루를 이어 보세요."
                    : page === "plan"
                      ? "한 해의 계획이 어떻게 자라고 있는지 확인하세요."
                      : page === "resource"
                        ? "함께 참고할 문서, 사진, 링크를 한곳에 모아요."
                        : "우리 농장과 참여자, 소중한 기록을 관리하세요."}
              </p>
            </div>
            {writable && page !== "admin" && (
              <button
                className="primary"
                onClick={() =>
                  setEditor({ kind: page === "home" ? "log" : (page as Kind) })
                }
              >
                <Plus size={19} />
                {page === "plan"
                  ? "계획 세우기"
                  : page === "resource"
                    ? "자료 올리기"
                    : "일지 쓰기"}
              </button>
            )}
          </div>
          {page === "home" ? (
            <>
              <section className="welcome-banner">
                <div>
                  <span className="pill">우리 농장의 기록장</span>
                  <h2>
                    같이 일하고,
                    <br />
                    같이 기억하는 농장.
                  </h2>
                  <p>작은 변화도 남겨 두면 다음 계절의 길잡이가 됩니다.</p>
                  <button
                    className="text-button"
                    onClick={() => navigate("plan")}
                  >
                    올해 계획 살펴보기 <ArrowUpRight size={17} />
                  </button>
                </div>
                <FarmArt />
              </section>
              <section className="stats-grid">
                <Stat
                  label="올해 계획"
                  value={stats.total}
                  unit="건"
                  icon={<CalendarDays />}
                  sub={`${today().slice(0, 4)}년 기준`}
                />
                <Stat
                  label="완료한 계획"
                  value={stats.complete}
                  unit="건"
                  icon={<CheckCircle2 />}
                  sub="결과를 남긴 계획"
                />
                <Stat
                  label="진행할 계획"
                  value={stats.pending}
                  unit="건"
                  icon={<Clock3 />}
                  sub="미실행 · 진행중"
                />
                <Stat
                  label="쌓인 작업일지"
                  value={logs.length}
                  unit="건"
                  icon={<BookOpen />}
                  sub="함께 기록한 모든 날"
                />
              </section>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="section-heading">
                    <h2>최근 작업일지</h2>
                    <button
                      className="text-button"
                      onClick={() => navigate("log")}
                    >
                      전체 보기 <ChevronRight size={15} />
                    </button>
                  </div>
                  {logs.length ? (
                    logs.slice(0, 4).map(card)
                  ) : (
                    <Empty
                      title="첫 번째 작업일지를 남겨 보세요"
                      description="오늘 한 일과 사진이 우리 농장의 기록이 됩니다."
                      action={
                        writable ? () => setEditor({ kind: "log" }) : undefined
                      }
                    />
                  )}
                </section>
                <div className="dashboard-right">
                  <section className="panel">
                    <div className="section-heading">
                      <h2>다가오는 작업</h2>
                      <CalendarDays size={19} />
                    </div>
                    {upcoming.length ? (
                      upcoming.slice(0, 3).map((e) => (
                        <button
                          className="upcoming"
                          key={e.id}
                          onClick={() => setDetail(e)}
                        >
                          <div className="date-square">
                            <small>{e.start_date!.slice(5, 7)}월</small>
                            <strong>{e.start_date!.slice(8, 10)}</strong>
                          </div>
                          <div>
                            <strong>{e.title}</strong>
                            <small>
                              {e.start_date} ~ {e.end_date}
                            </small>
                          </div>
                          <ChevronRight size={16} />
                        </button>
                      ))
                    ) : (
                      <p className="empty-small">
                        예정된 작업이 없습니다.
                        <br />
                        연간 계획에서 다음 작업을 추가해 보세요.
                      </p>
                    )}
                    {overdue.length > 0 && (
                      <button
                        className="overdue"
                        onClick={() => {
                          navigate("plan");
                          setYear(overdue[0].target_year!);
                          setDetail(overdue[0]);
                        }}
                      >
                        <AlertCircle size={17} />
                        기한이 지난 미완료 계획 {overdue.length}건
                        <ChevronRight size={15} />
                      </button>
                    )}
                  </section>
                  <section className="panel">
                    <div className="section-heading">
                      <h2>새로 공유한 자료</h2>
                      <button
                        className="text-button"
                        onClick={() => navigate("resource")}
                      >
                        <ArrowUpRight size={19} />
                        <span className="sr-only">자료실 보기</span>
                      </button>
                    </div>
                    {active.filter((e) => e.kind === "resource").length ? (
                      active
                        .filter((e) => e.kind === "resource")
                        .sort((a, b) =>
                          b.created_at.localeCompare(a.created_at),
                        )
                        .slice(0, 2)
                        .map(card)
                    ) : (
                      <p className="empty-small">
                        아직 공유한 자료가 없습니다.
                        <br />
                        농장에 도움이 될 자료를 함께 나눠요.
                      </p>
                    )}
                  </section>
                </div>
              </div>
            </>
          ) : page === "admin" ? (
            <Admin s={s} refresh={refresh} notify={setNotice} />
          ) : (
            <>
              {page === "plan" && (
                <div className="plan-summary">
                  <strong>{year}년 실적</strong>
                  <span>전체 {stats.total}</span>
                  <span className="green">완료 {stats.complete}</span>
                  <span>미완료 {stats.pending}</span>
                  <span>보류 {stats.held}</span>
                  <span>취소 {stats.cancelled}</span>
                  <small>계획 외 작업은 완료 건수에 포함하지 않습니다.</small>
                </div>
              )}
              <section className="panel listing">
                <div className="filters">
                  <label className="search">
                    <Search size={18} />
                    <input
                      aria-label="검색어"
                      placeholder="제목, 내용, 구역, 작물 검색"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  {page === "plan" && (
                    <>
                      <label>
                        목표 연도
                        <input
                          type="number"
                          min="2000"
                          max="2200"
                          value={year}
                          onChange={(e) => setYear(Number(e.target.value))}
                        />
                      </label>
                      <label>
                        예정 월
                        <select
                          value={month}
                          onChange={(e) => setMonth(e.target.value)}
                        >
                          <option value="">전체 월</option>
                          {Array.from({ length: 12 }, (_, i) =>
                            String(i + 1).padStart(2, "0"),
                          ).map((m) => (
                            <option key={m} value={m}>
                              {Number(m)}월
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {page === "log" && (
                    <>
                      <label>
                        시작일
                        <input
                          type="date"
                          value={from}
                          onChange={(e) => setFrom(e.target.value)}
                        />
                      </label>
                      <label>
                        종료일
                        <input
                          type="date"
                          value={to}
                          onChange={(e) => setTo(e.target.value)}
                        />
                      </label>
                      <label>
                        연결 계획
                        <select
                          value={plan}
                          onChange={(e) => setPlan(e.target.value)}
                        >
                          <option value="">전체 계획</option>
                          <option value="none">계획 외 작업</option>
                          {plans.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.target_year} · {p.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {page === "resource" && (
                    <label>
                      분류
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="">전체 분류</option>
                        {Array.from(
                          new Set(
                            active
                              .filter((e) => e.kind === "resource")
                              .map((e) => e.category),
                          ),
                        ).map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    작성자
                    <select
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                    >
                      <option value="">전체 작성자</option>
                      {s.members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="text-button"
                    onClick={() =>
                      exportCsv({
                        ...s,
                        entries: filtered,
                        assets: s.assets.filter((a) =>
                          filtered.some((e) => e.id === a.entry_id),
                        ),
                      })
                    }
                  >
                    CSV
                  </button>
                </div>
                <div className="list-heading">
                  <strong>
                    {filtered.length}개의{" "}
                    {page === "log"
                      ? "작업일지"
                      : page === "plan"
                        ? "계획"
                        : "자료"}
                  </strong>
                  <small>
                    {page === "log"
                      ? "실제 작업일 기준"
                      : page === "plan"
                        ? "목표 연도 기준 · 연결된 일지는 다른 연도도 포함"
                        : "새로 등록한 순"}
                  </small>
                </div>
                {filtered.length ? (
                  page === "plan" ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>예정 시기 / 계획</th>
                            <th>상태</th>
                            <th>실제 실행일 / 결과</th>
                            <th>일지</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((e) => (
                            <tr key={e.id}>
                              <td>
                                <small>
                                  {e.start_date} ~ {e.end_date}
                                </small>
                                <button
                                  className="text-button"
                                  onClick={() => setDetail(e)}
                                >
                                  {e.title}
                                </button>
                                <p>{e.body}</p>
                              </td>
                              <td>
                                <span
                                  className={
                                    "badge status-" +
                                    [
                                      "미실행",
                                      "진행중",
                                      "완료",
                                      "보류",
                                      "취소",
                                    ].indexOf(e.status)
                                  }
                                >
                                  {e.status}
                                </span>
                              </td>
                              <td>
                                {e.actual_date || "—"}
                                <p>{e.result || "결과 미입력"}</p>
                              </td>
                              <td>
                                {logs.filter((l) => l.plan_id === e.id).length}
                                건
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="records-list">{filtered.map(card)}</div>
                  )
                ) : (
                  <Empty
                    title={
                      query || from || to || author || plan || category
                        ? "조건에 맞는 기록이 없습니다"
                        : "아직 기록이 없습니다"
                    }
                    description="새로운 기록을 추가하거나 검색 조건을 바꿔 보세요."
                    action={
                      writable
                        ? () => setEditor({ kind: page as Kind })
                        : undefined
                    }
                  />
                )}
              </section>
            </>
          )}
          <footer className="page-footer">
            <Sprout size={15} /> 함께 가꾸는 농장, 함께 쌓는 기록{" "}
            <span>Asia/Seoul · 온라인 공동 저장</span>
          </footer>
        </main>
      </div>
      {passwordOpen && <Password onClose={() => setPasswordOpen(false)} />}
      {notice && (
        <div role="status" className="toast">
          {notice}
        </div>
      )}
      {editor && (
        <Editor
          kind={editor.kind}
          entry={editor.entry}
          snapshot={s}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            await refresh();
            setNotice("기록과 첨부파일을 저장했습니다.");
          }}
        />
      )}
      {detail && !editor && (
        <Detail
          key={detail.id}
          entry={s.entries.find((e) => e.id === detail.id) || detail}
          snapshot={s}
          me={me}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditor({
              kind: detail.kind,
              entry: s.entries.find((e) => e.id === detail.id) || detail,
            });
            setDetail(null);
          }}
          onRefresh={refresh}
          onOpen={setDetail}
        />
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  unit,
  icon,
  sub,
}: {
  label: string;
  value: number;
  unit: string;
  icon: React.ReactNode;
  sub: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <small>{sub}</small>
    </div>
  );
}
function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Sprout size={31} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button className="secondary" onClick={action}>
          <Plus size={16} />첫 기록 남기기
        </button>
      )}
    </div>
  );
}
