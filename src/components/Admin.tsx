import { useState, type FormEvent } from "react";
import {
  Download,
  FolderArchive,
  Users,
  Settings,
  Trash2,
  Copy,
} from "lucide-react";
import type { Snapshot, Role } from "../lib/types";
import { backup, db, exportCsv, purge, rpc } from "../lib/api";
import { readableError, roleLabels } from "../lib/utils.js";
export function Admin({
  s,
  refresh,
  notify,
}: {
  s: Snapshot;
  refresh: () => Promise<void>;
  notify: (t: string) => void;
}) {
  const [settingsVersion, setSettingsVersion] = useState(s.settings.version);
  const [name, setName] = useState(s.settings.name),
    [zones, setZones] = useState(s.settings.zones.join(", ")),
    [crops, setCrops] = useState(s.settings.crops.join(", "));
  const [categories, setCategories] = useState(
    (s.settings.resource_categories || ["일반"]).join("\n"),
  );
  const [email, setEmail] = useState(""),
    [role, setRole] = useState<Role>("editor"),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      notify(message);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  const usage = s.assets.reduce((n, a) => n + a.size, 0);
  const trash = s.entries.filter((e) => e.deleted_at);
  return (
    <div className="admin-grid">
      {error && (
        <p className="alert error full" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <h2>
          <Settings size={20} />
          농장 설정
        </h2>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            act(async () => {
              await rpc("save_settings", {
                p_version: settingsVersion,
                p_name: name,
                p_zones: zones
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
                p_crops: crops
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              });
              setSettingsVersion(settingsVersion + 1);
            }, "농장 설정을 저장했습니다.");
          }}
        >
          <label>
            농장 이름
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            구역 <small>쉼표로 구분</small>
            <input
              value={zones}
              onChange={(e) => setZones(e.target.value)}
              placeholder="직접 사용하는 구역 이름을 입력하세요"
            />
          </label>
          <label>
            작물 <small>쉼표로 구분</small>
            <input
              value={crops}
              onChange={(e) => setCrops(e.target.value)}
              placeholder="직접 기르는 작물을 입력하세요"
            />
          </label>
          <button className="primary" disabled={busy}>
            설정 저장
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>자료실 분류 관리</h2>
        {s.settings.resource_categories === undefined ? (
          <p className="muted">
            분류 목록 관리를 사용하려면 데이터베이스 업데이트가 필요합니다. 기존
            자료실은 계속 사용할 수 있습니다.
          </p>
        ) : (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              act(async () => {
                await rpc("save_resource_categories", {
                  p_version: settingsVersion,
                  p_categories: categories
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean),
                });
                setSettingsVersion(settingsVersion + 1);
              }, "자료실 분류를 저장했습니다.");
            }}
          >
            <label>
              사용할 분류 <small>한 줄에 하나씩, 최대 100개</small>
              <textarea
                required
                rows={6}
                value={categories}
                onChange={(e) => setCategories(e.target.value)}
                placeholder={"일반\n교육\n회의록"}
              />
            </label>
            <p className="muted">
              필요한 분류를 추가하거나 목록을 수정하세요. 목록에서 빼도 기존
              자료와 그 분류는 유지됩니다. 기존 자료의 분류 변경은 해당 자료의
              수정 화면에서 할 수 있습니다.
            </p>
            <button className="primary" disabled={busy}>
              분류 저장
            </button>
          </form>
        )}
      </section>
      <section className="panel">
        <h2>
          <FolderArchive size={20} />
          사용량과 백업
        </h2>
        <div className="usage">
          <strong>
            {(usage / 1000000).toFixed(1)}
            <small> MB / 앱 한도 900MB</small>
          </strong>
          <progress max={900000000} value={usage} />
          <p className="muted">
            등록·예약된 파일 크기 기준입니다. 휴지통 파일도 포함합니다. DB·월
            전송량은 Supabase 대시보드에서 확인하세요.
          </p>
        </div>
        <div className="button-row">
          <button disabled={busy} onClick={() => exportCsv(s)}>
            <Download size={17} />
            CSV 내려받기
          </button>
          <button
            disabled={busy}
            onClick={() =>
              act(() => backup(s), "데이터와 첨부파일 백업을 내려받았습니다.")
            }
          >
            <FolderArchive size={17} />
            전체 백업 ZIP
          </button>
        </div>
        <small>
          계정 비밀번호·로그인 토큰은 포함하지 않습니다. 파일 합계 100MB 초과 시
          PC 백업 명령을 사용하세요. 무료 자동 백업은 제공하지 않습니다.
        </small>
      </section>
      <section className="panel full">
        <h2>
          <Users size={20} />
          참여자와 권한
        </h2>
        <p className="muted">
          참여자는 본인 기록을 관리하고, 열람자는 보기만 가능합니다. 접근 해제는
          다음 서버 요청부터 적용됩니다.
        </p>
        <div className="member-list">
          {s.members.map((m) => (
            <div className="member-row" key={m.user_id}>
              <div className="avatar">{m.display_name.slice(0, 1)}</div>
              <div>
                <strong>{m.display_name}</strong>
                <small>{m.active ? "참여 중" : "접근 해제됨"}</small>
              </div>
              <select
                aria-label={m.display_name + " 권한"}
                value={m.role}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value;
                  if (
                    confirm(
                      `${m.display_name} 님을 ${roleLabels[next as Role]}(으)로 변경할까요?`,
                    )
                  )
                    act(
                      () =>
                        rpc("update_member", {
                          p_user: m.user_id,
                          p_role: next,
                          p_active: m.active,
                        }),
                      "권한을 변경했습니다.",
                    );
                }}
              >
                {Object.entries(roleLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button
                className={m.active ? "danger" : "secondary"}
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      `${m.display_name} 님의 접근을 ${m.active ? "해제" : "복구"}할까요?`,
                    )
                  )
                    act(
                      () =>
                        rpc("update_member", {
                          p_user: m.user_id,
                          p_role: m.role,
                          p_active: !m.active,
                        }),
                      "접근 권한을 변경했습니다.",
                    );
                }}
              >
                {m.active ? "접근 해제" : "접근 복구"}
              </button>
            </div>
          ))}
        </div>
        <div className="inset">
          <h3>참여자 초대 코드 만들기</h3>
          <p className="muted">
            먼저 서비스 소유자가 Supabase → Authentication → Users → Add
            user에서 계정을 만드세요. 메일 발송 없이 계정과 7일 유효한 코드를
            직접 전달합니다. 첫 로그인 후 비밀번호를 변경해 주세요.
          </p>
          <form
            className="invite-form"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                setCode(
                  await rpc<string>("create_invitation", {
                    p_email: email,
                    p_role: role,
                  }),
                );
              }, "초대 코드를 만들었습니다. 안전한 방법으로 대상자에게 전달해 주세요.");
            }}
          >
            <label>
              초대할 계정 이메일
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              초기 권한
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                <option value="editor">참여자</option>
                <option value="viewer">열람자</option>
              </select>
            </label>
            <button className="primary" disabled={busy}>
              코드 만들기
            </button>
          </form>
          {code && (
            <div className="invite-code">
              <code>{code}</code>
              <button
                onClick={() =>
                  navigator.clipboard
                    .writeText(code)
                    .then(() => notify("초대 코드를 복사했습니다."))
                    .catch(() =>
                      setError(
                        "복사하지 못했습니다. 코드를 직접 선택해 복사해 주세요.",
                      ),
                    )
                }
              >
                <Copy size={16} />
                복사
              </button>
              <small>
                이 화면을 닫으면 다시 표시되지 않습니다. 해당 이메일 계정만 한
                번 사용할 수 있습니다.
              </small>
            </div>
          )}
        </div>
      </section>
      <section className="panel full">
        <h2>미완료 첨부 복구</h2>
        <p className="muted">
          업로드 도중 연결이 끊긴 파일입니다. 업로드 확인으로 저장을 마치거나,
          정리하여 예약 용량을 돌려받으세요.
        </p>
        {s.assets.filter((a) => !a.ready).length ? (
          s.assets
            .filter((a) => !a.ready)
            .map((a) => (
              <div className="trash-row" key={a.id}>
                <div>
                  <strong>{a.name}</strong>
                  <small>
                    {(a.size / 1024).toFixed(0)}KB ·{" "}
                    {s.entries.find((e) => e.id === a.entry_id)?.title}
                  </small>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => rpc("finish_asset", { p_id: a.id }),
                      "첨부 저장을 완료했습니다.",
                    )
                  }
                >
                  업로드 확인
                </button>
                <button
                  disabled={busy}
                  className="danger"
                  onClick={() => {
                    if (confirm("이 미완료 첨부파일을 정리할까요?"))
                      act(async () => {
                        const { error } = await db.storage
                          .from("farm-files")
                          .remove([a.path]);
                        if (error) throw error;
                        await rpc("cancel_asset", { p_id: a.id });
                      }, "미완료 첨부를 정리했습니다.");
                  }}
                >
                  정리
                </button>
              </div>
            ))
        ) : (
          <p className="empty-small">미완료 첨부가 없습니다.</p>
        )}
      </section>
      <section className="panel full">
        <h2>
          <Trash2 size={20} />
          휴지통 <span className="count">{trash.length}</span>
        </h2>
        <p className="muted">
          복원하면 첨부파일도 다시 표시됩니다. 영구 삭제는 되돌릴 수 없습니다.
        </p>
        {trash.length ? (
          trash.map((e) => (
            <div className="trash-row" key={e.id}>
              <div>
                <strong>{e.title}</strong>
                <small>
                  삭제{" "}
                  {new Date(e.deleted_at!).toLocaleDateString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}
                </small>
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  act(
                    () =>
                      rpc("trash_entry", {
                        p_id: e.id,
                        p_version: e.version,
                        p_restore: true,
                      }),
                    "기록을 복원했습니다.",
                  )
                }
              >
                복원
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (
                    prompt(
                      `첨부파일까지 영구 삭제합니다. 확인하려면 기록 제목을 입력하세요: ${e.title}`,
                    ) === e.title
                  )
                    act(
                      () => purge(e, s.assets, s.entries),
                      "기록과 파일을 영구 삭제했습니다.",
                    );
                }}
              >
                영구 삭제
              </button>
            </div>
          ))
        ) : (
          <p className="empty-small">휴지통이 비어 있습니다.</p>
        )}
      </section>
    </div>
  );
}
