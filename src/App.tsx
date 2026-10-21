import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Sprout,
  BookOpen,
  CalendarDays,
  FolderOpen,
  Plus,
  Search,
  ArrowUpRight,
  ChevronRight,
  RefreshCw,
  LogOut,
  Leaf,
  AlertCircle,
  KeyRound,
  Users,
  Camera,
} from "lucide-react";
import { configured, db, snapshot, exportCsv } from "./lib/api";
import {
  planStats,
  comparePlanDates,
  readableError,
  roleLabels,
  today,
  matchesSearch,
  matchesPlanSearch,
  planMonthSearchFields,
  searchDateForms,
} from "./lib/utils.js";
import type { Entry, Kind, Member, Snapshot } from "./lib/types";
import { Auth, Join } from "./components/Auth";
import { Editor } from "./components/Editor";
import { Detail } from "./components/Detail";
import { Admin } from "./components/Admin";
import {
  isActivity,
  cropsOf,
  zonesOf,
  groupsOf,
  tasksOf,
  plansOf,
  hasPlan,
} from "./lib/work";
import { Thumbnail } from "./components/Thumbnail";
import { FarmWeather } from "./components/FarmWeather";
import { FarmingInfo } from "./components/FarmingInfo";
import { TextSizeControl } from "./components/TextSizeControl";
import { navigation } from "./lib/navigation";
import { SiteMap } from "./components/SiteMap";
import { Password } from "./components/Password";
export default function App() {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null),
    [authReady, setAuthReady] = useState(false),
    [s, setS] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [page, setPage] = useState("home"),
    [editor, setEditor] = useState<{
      kind: Kind;
      entry?: Entry;
      initial?: Partial<Entry> & { photo_first?: boolean; copied?: boolean };
    } | null>(null),
    [detail, setDetail] = useState<Entry | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState(""),
    [author, setAuthor] = useState(""),
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
    setAuthor("");
  }
  function openCurrentPlans() {
    navigate("plan");
    setQuery(`목표연도:${today().slice(0, 4)}`);
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
  const stats = planStats(
    plans.filter((e) => e.target_year === Number(today().slice(0, 4))),
  );
  const logs = active
    .filter((e) => e.kind === "log" && !isActivity(e))
    .sort(
      (a, b) =>
        (b.work_date || "").localeCompare(a.work_date || "") ||
        b.created_at.localeCompare(a.created_at),
    );
  const activityLogs = active.filter(isActivity);
  const frequent = Object.values(
    logs
      .filter((e) => e.author_id === me.user_id)
      .flatMap((e) => tasksOf(e))
      .reduce(
        (items, e) => {
          const key = `${e.group}:${e.task}`;
          items[key] = {
            group: e.group || "",
            task: e.task,
            count: (items[key]?.count || 0) + 1,
          };
          return items;
        },
        {} as Record<string, { group: string; task: string; count: number }>,
      ),
  )
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
  const quick = frequent.length
    ? frequent
    : [
        { group: "물·양분 관리", task: "관수" },
        { group: "잡초·병해충", task: "제초" },
        { group: "수확·수확 후", task: "수확" },
        { group: "관찰·점검", task: "생육 관찰" },
      ];
  const overdue = plans.filter(
    (e) => e.end_date! < today() && ["미실행", "진행중"].includes(e.status),
  );
  const upcoming = plans
    .filter(
      (e) => e.end_date! >= today() && ["미실행", "진행중"].includes(e.status),
    )
    .sort((a, b) => comparePlanDates(a, b));
  const name = (id: string) =>
    s.members.find((m) => m.user_id === id)?.display_name || "이전 참여자";
  const filtered = active
    .filter((e) =>
      page === "activity"
        ? isActivity(e)
        : e.kind === page && (page !== "log" || !isActivity(e)),
    )
    .filter((e) =>
      ["log", "activity"].includes(page)
        ? matchesSearch(query, [
            e.title,
            e.body,
            e.result,
            e.activity_category,
            ...cropsOf(e),
            ...zonesOf(e),
            ...groupsOf(e),
            ...tasksOf(e).map((w) => w.task),
            name(e.author_id),
            ...(e.participant_ids || []).map(name),
            ...searchDateForms(e.work_date),
            e.quantity == null ? "" : `${e.quantity} ${e.quantity_unit || ""}`,
            page === "log" && !groupsOf(e).length ? "분류 미지정" : "",
            ...(plansOf(e).length
              ? plansOf(e).flatMap((id) => {
                  const linked = plans.find((p) => p.id === id);
                  return [linked?.title || "", linked?.target_year || ""];
                })
              : ["계획 외 작업"]),
            ...s.assets
              .filter((a) => a.entry_id === e.id && a.ready)
              .map((a) => a.name),
          ])
        : page === "plan"
          ? matchesPlanSearch(query, e, [
              e.title,
              e.body,
              e.result,
              e.status,
              e.target_year,
              `${e.target_year}년`,
              ...planMonthSearchFields(e.start_date, e.end_date),
              ...searchDateForms(e.start_date),
              ...searchDateForms(e.end_date),
              ...searchDateForms(e.actual_date),
              ...cropsOf(e),
              ...zonesOf(e),
              name(e.author_id),
              e.assignee ? name(e.assignee) : "",
              e.completed_by ? name(e.completed_by) : "",
              ...active
                .filter((l) => l.kind === "log" && hasPlan(l, e.id))
                .flatMap((l) => [
                  l.title,
                  l.body,
                  l.result,
                  ...cropsOf(l),
                  ...zonesOf(l),
                  ...groupsOf(l),
                  ...tasksOf(l).map((w) => w.task),
                  name(l.author_id),
                  ...(l.participant_ids || []).map(name),
                  ...searchDateForms(l.work_date),
                  ...s.assets
                    .filter((a) => a.entry_id === l.id && a.ready)
                    .map((a) => a.name),
                ]),
            ])
          : (
              e.title +
              " " +
              e.body +
              " " +
              e.result +
              " " +
              e.zone +
              " " +
              e.crop +
              " " +
              (e.work_task || "") +
              " " +
              (e.work_group || "")
            )
              .toLowerCase()
              .includes(query.toLowerCase()),
    )
    .filter((e) => page !== "resource" || !author || e.author_id === author)
    .filter((e) => page !== "resource" || !category || e.category === category)
    .sort((a, b) =>
      page === "plan"
        ? comparePlanDates(a, b)
        : (b.work_date || b.start_date || b.created_at).localeCompare(
            a.work_date || a.start_date || a.created_at,
          ),
    );
  const planSummary = planStats(filtered);
  const card = (e: Entry) => (
    <button className="record-card" key={e.id} onClick={() => setDetail(e)}>
      {(() => {
        const photo = s.assets.find(
          (a) => a.entry_id === e.id && a.ready && a.mime.startsWith("image/"),
        );
        return photo ? <Thumbnail asset={photo} /> : null;
      })()}
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
          {zonesOf(e).map((v) => (
            <span key={`zone-${v}`}>{v}</span>
          ))}
          {cropsOf(e).map((v) => (
            <span key={`crop-${v}`}>{v}</span>
          ))}
          {tasksOf(e).map((v) => (
            <span key={`task-${v.group}-${v.task}`}>{v.task}</span>
          ))}
          {isActivity(e) && <span>{e.activity_category}</span>}
          {e.kind === "log" && !isActivity(e) && !groupsOf(e).length && (
            <span>분류 미지정</span>
          )}
          {e.kind === "log" && (
            <span>
              {plansOf(e).length
                ? `계획 연결 ${plansOf(e).length}개`
                : "계획 외 작업"}
            </span>
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
          <a
            className="community-brand"
            href="#"
            aria-label="함께그린 홈으로"
            onClick={(event) => {
              event.preventDefault();
              navigate("home");
            }}
          >
            <Sprout size={25} aria-hidden="true" />
            <strong>함께그린</strong>
          </a>
          <div className="breadcrumb">
            우리 농장 <ChevronRight size={14} />
            <span>
              {page === "admin"
                ? "농장 관리"
                : navigation.find((n) => n.id === page)?.name}
            </span>
          </div>
          <div className="top-actions">
            <TextSizeControl userId={me.user_id} />
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
          <div
            className={`page-heading${page === "home" ? " home-heading" : ""}`}
          >
            <div>
              <span className="eyebrow">
                {page === "home"
                  ? "OUR FARM, TOGETHER"
                  : "함께 가꾸는 농장의 기록"}
              </span>
              <h1>
                {page === "home"
                  ? "농장의 오늘을 살펴보세요"
                  : page === "admin"
                    ? "농장 관리"
                    : navigation.find((n) => n.id === page)?.name}
              </h1>
              <p>
                {page === "home"
                  ? `${me.display_name} 님, 반갑습니다. 오늘의 일도 함께 기록해 볼까요?`
                  : page === "log"
                    ? "작업을 고르고 사진을 남기세요. 작물별 재배이력도 여기서 찾아볼 수 있어요."
                    : page === "activity"
                      ? "회의·교육·행사·판매·나눔 등 농장 밖의 이야기도 함께 남겨요."
                      : page === "plan"
                        ? "한 해의 계획이 어떻게 자라고 있는지 확인하세요."
                        : page === "resource"
                          ? "함께 참고할 문서, 사진, 링크를 한곳에 모아요."
                          : page === "info"
                            ? "농사에 필요한 날씨·토양·재배기술·재해 정보를 찾아보세요."
                            : page === "sitemap"
                              ? "앱의 전체 메뉴 구조와 주요 기능을 한눈에 확인하세요. 메뉴 이름을 누르면 이동합니다."
                              : "우리 농장과 참여자, 소중한 기록을 관리하세요."}
              </p>
            </div>
            {page === "home" && <FarmWeather />}
            {writable &&
              ["plan", "log", "activity", "resource"].includes(page) && (
                <button
                  className="primary record-primary"
                  disabled={page === "activity" && !s.settings.work_catalog}
                  onClick={() =>
                    setEditor({
                      kind:
                        page === "home" || page === "activity"
                          ? "log"
                          : (page as Kind),
                      initial:
                        page === "activity"
                          ? { record_type: "activity" }
                          : undefined,
                    })
                  }
                >
                  <Plus size={19} />
                  {page === "plan"
                    ? "계획 세우기"
                    : page === "resource"
                      ? "자료 올리기"
                      : page === "activity"
                        ? "활동 기록하기"
                        : "농작업 기록하기"}
                </button>
              )}
          </div>
          {page === "activity" && !s.settings.work_catalog && (
            <p className="alert">
              운영·교류 기록을 사용하려면 데이터베이스 업데이트가 필요합니다.
            </p>
          )}
          {["home", "log"].includes(page) && !s.settings.work_catalog && (
            <p className="alert">
              선택형 농작업 입력은 데이터베이스 업데이트 후 사용할 수 있습니다.
              기존 일지는 계속 조회·작성할 수 있습니다.
            </p>
          )}
          {page === "log" && writable && (
            <details className="quick-record-tools panel">
              <summary>빠른 기록 도구</summary>
              <div className="quick-record">
                <div>
                  <span className="eyebrow">오늘의 기록, 간단하게</span>
                  <h2>작업을 고르거나 사진부터 남겨 보세요</h2>
                  <p className="muted">메모는 짧게, 계획 연결은 필요할 때만.</p>
                </div>
                {writable && (
                  <div className="quick-actions">
                    <button
                      onClick={() =>
                        setEditor({
                          kind: "log",
                          initial: { photo_first: true },
                        })
                      }
                    >
                      <Camera size={18} />
                      사진부터 기록
                    </button>
                    <button
                      onClick={() => {
                        navigate("log");
                        setNotice(
                          "복사할 일지를 열고 ‘이전 작업 복사’를 눌러 주세요.",
                        );
                      }}
                    >
                      이전 작업 복사
                    </button>
                  </div>
                )}
                {writable && s.settings.work_catalog && (
                  <div>
                    <h3>
                      {frequent.length ? "자주 한 작업" : "빠른 작업 선택"}
                    </h3>
                    <div className="work-tasks">
                      {quick.map((q) => (
                        <button
                          key={q.task}
                          onClick={() =>
                            setEditor({
                              kind: "log",
                              initial: {
                                work_group: q.group,
                                work_task: q.task,
                              },
                            })
                          }
                        >
                          {q.task}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          )}
          {page === "home" ? (
            <>
              <section className="stats-grid">
                <Stat
                  label="올해 계획"
                  onClick={() => openCurrentPlans()}
                  value={stats.total}
                  unit="건"
                  icon={<CalendarDays />}
                  sub={`${today().slice(0, 4)}년 기준`}
                />
                <Stat
                  label="운영·교류 기록"
                  onClick={() => navigate("activity")}
                  value={activityLogs.length}
                  unit="건"
                  icon={<Users />}
                  sub="회의·교육·행사 등"
                />
                <Stat
                  label="공유한 자료"
                  onClick={() => navigate("resource")}
                  value={active.filter((e) => e.kind === "resource").length}
                  unit="건"
                  icon={<FolderOpen />}
                  sub="문서·사진·링크"
                />
                <Stat
                  label="쌓인 농작업일지"
                  onClick={() => navigate("log")}
                  value={logs.length}
                  unit="건"
                  icon={<BookOpen />}
                  sub="함께 기록한 모든 날"
                />
              </section>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="section-heading">
                    <h2>최근 농작업일지</h2>
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
                      title="첫 번째 농작업일지를 남겨 보세요"
                      description="오늘 한 일과 사진이 우리 농장의 기록이 됩니다."
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
                        농장계획에서 다음 작업을 추가해 보세요.
                      </p>
                    )}
                    {overdue.length > 0 && (
                      <button
                        className="overdue"
                        onClick={() => {
                          navigate("plan");
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
                        <span className="sr-only">자료함 보기</span>
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
          ) : page === "sitemap" ? (
            <SiteMap
              farmName={s.settings.name}
              role={me.role}
              onNavigate={navigate}
            />
          ) : page === "info" ? (
            <FarmingInfo />
          ) : page === "admin" ? (
            <Admin s={s} refresh={refresh} notify={setNotice} />
          ) : (
            <>
              {page === "plan" && (
                <details className="plan-results">
                  <summary>계획 상태·결과 요약 보기</summary>
                  <div className="plan-summary">
                    <strong>검색된 계획</strong>
                    <span>전체 {planSummary.total}</span>
                    <span className="green">완료 {planSummary.complete}</span>
                    <span>미완료 {planSummary.pending}</span>
                    <span>보류 {planSummary.held}</span>
                    <span>취소 {planSummary.cancelled}</span>
                    <small>계획 외 작업은 완료 건수에 포함하지 않습니다.</small>
                  </div>
                </details>
              )}
              <section className="panel listing">
                <div className="filters">
                  <label className="search">
                    <Search size={18} />
                    <input
                      aria-label="검색어"
                      type={
                        ["log", "plan", "activity"].includes(page)
                          ? "search"
                          : "text"
                      }
                      placeholder={
                        page === "log"
                          ? "제목·작성자·작물·장소·작업·날짜 찾기"
                          : page === "plan"
                            ? "제목·작성자·연도·월·상태·담당자·결과 찾기"
                            : page === "activity"
                              ? "제목·내용·날짜·분류·작성자·참여자·계획·파일 찾기"
                              : "제목, 내용, 구역, 작물 검색"
                      }
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  {page === "resource" && (
                    <label>
                      분류
                      <select
                        aria-label="자료 분류"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="">전체 분류</option>
                        {Array.from(
                          new Set([
                            ...(s.settings.resource_categories || []),
                            ...active
                              .filter((e) => e.kind === "resource")
                              .map((e) => e.category),
                          ]),
                        ).map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {page === "resource" && (
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
                  )}
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
                      ? "농작업일지"
                      : page === "activity"
                        ? "운영·교류 기록"
                        : page === "plan"
                          ? "계획"
                          : "자료"}
                  </strong>
                  <small>
                    {["log", "activity"].includes(page)
                      ? "실제 활동일 기준"
                      : page === "plan"
                        ? "가까운 일정순 · 지난 일정은 아래에 표시"
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
                                {
                                  active.filter(
                                    (l) => l.kind === "log" && hasPlan(l, e.id),
                                  ).length
                                }
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
                      query || author || category
                        ? "조건에 맞는 기록이 없습니다"
                        : "아직 기록이 없습니다"
                    }
                    description="새로운 기록을 추가하거나 검색 조건을 바꿔 보세요."
                    action={
                      writable &&
                      (page !== "activity" || !!s.settings.work_catalog)
                        ? () =>
                            setEditor({
                              kind:
                                page === "activity" ? "log" : (page as Kind),
                              initial:
                                page === "activity"
                                  ? { record_type: "activity" }
                                  : undefined,
                            })
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
          initial={editor.initial}
          userId={me.user_id}
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
          onCopy={
            writable && detail.kind === "log"
              ? () => {
                  const source =
                    s.entries.find((e) => e.id === detail.id) || detail;
                  setEditor({
                    kind: "log",
                    initial: {
                      copied: true,
                      work_groups: source.work_groups,
                      work_items: source.work_items,
                      crop_names: source.crop_names,
                      zone_names: source.zone_names,
                      plan_ids: source.plan_ids,
                      title: source.title,
                      body: source.body,
                      crop: source.crop,
                      zone: source.zone,
                      plan_id: source.plan_id,
                      record_type: source.record_type,
                      work_group: source.work_group,
                      work_task: source.work_task,
                      activity_category: source.activity_category,
                      quantity: source.quantity,
                      quantity_unit: source.quantity_unit,
                      participant_ids: source.participant_ids,
                    },
                  });
                  setDetail(null);
                }
              : undefined
          }
          onRecord={
            writable && detail.kind === "plan"
              ? (activity = false) => {
                  setEditor({
                    kind: "log",
                    initial: {
                      plan_id: detail.id,
                      crop: detail.crop,
                      zone: detail.zone,
                      record_type: activity ? "activity" : "farm",
                    },
                  });
                  setDetail(null);
                }
              : undefined
          }
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
  onClick,
}: {
  label: string;
  value: number;
  unit: string;
  icon: React.ReactNode;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="stat-card"
      onClick={onClick}
      aria-label={`${label} ${value}${unit} 목록 보기`}
    >
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <small>{sub}</small>
    </button>
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
