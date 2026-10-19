import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, X, Trash2, Pencil } from "lucide-react";
import type { Entry, Member, Snapshot, Asset } from "../lib/types";
import { fileBlob, rpc } from "../lib/api";
import { canEdit, download, readableError, safeUrl } from "../lib/utils.js";
import { Discussion } from "./Discussion";
export function Attachment({ asset }: { asset: Asset }) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let url = "";
    if (asset.mime.startsWith("image/"))
      fileBlob(asset)
        .then((blob) => {
          url = URL.createObjectURL(blob);
          if (active) setSrc(url);
          else URL.revokeObjectURL(url);
        })
        .catch((e) => {
          if (active) setError(readableError(e));
        });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [asset.id]);
  async function get(preview = false) {
    setBusy(true);
    setError("");
    try {
      const blob = await fileBlob(asset);
      if (preview) {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else download(blob, asset.name);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="attachment">
      {src && <img src={src} alt={asset.name} />}
      <span>{asset.name}</span>
      <small>{(asset.size / 1024).toFixed(0)}KB</small>
      <div className="button-row">
        <button disabled={busy} className="text-button" onClick={() => get()}>
          <Download size={15} />
          내려받기
        </button>
        {asset.mime === "application/pdf" && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => get(true)}
          >
            PDF 보기
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
export function Detail({
  entry: e,
  snapshot: s,
  me,
  onClose,
  onEdit,
  onRefresh,
  onOpen,
}: {
  entry: Entry;
  snapshot: Snapshot;
  me: Member;
  onClose: () => void;
  onEdit: () => void;
  onRefresh: () => Promise<void>;
  onOpen: (e: Entry) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const name = (id: string) =>
    s.members.find((m) => m.user_id === id)?.display_name || "이전 참여자";
  const logs = s.entries.filter((l) => l.plan_id === e.id && !l.deleted_at);
  const linked = s.entries.find((p) => p.id === e.plan_id);
  const assets = s.assets.filter((a) => a.entry_id === e.id && a.ready);
  async function trash() {
    if (!confirm("휴지통으로 이동할까요? 관리자가 복원할 수 있습니다.")) return;
    setBusy(true);
    try {
      await rpc("trash_entry", { p_id: e.id, p_version: e.version });
      await onRefresh();
      onClose();
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog className="editor detail" ref={dialog} onCancel={onClose}>
      <div className="dialog-title">
        <span className="eyebrow">
          {e.kind === "log"
            ? "작업일지"
            : e.kind === "plan"
              ? "연간 계획"
              : "공유 자료"}
        </span>
        <button className="icon-button" aria-label="닫기" onClick={onClose}>
          <X />
        </button>
      </div>
      <h2>{e.title}</h2>
      <p className="muted">
        {e.work_date || e.start_date || e.created_at.slice(0, 10)} ·{" "}
        {name(e.author_id)}
        {e.zone && " · " + e.zone}
        {e.crop && " · " + e.crop}
      </p>
      <p className="prose">{e.body || "등록된 설명이 없습니다."}</p>
      {e.kind === "log" && (
        <div className="inset">
          <small>연결된 계획</small>
          {linked ? (
            <button className="text-button" onClick={() => onOpen(linked)}>
              {linked.target_year} · {linked.title}
            </button>
          ) : (
            <p>계획 외 작업</p>
          )}
        </div>
      )}
      {e.kind === "plan" && (
        <>
          <div className="inset">
            <span className={"badge status-" + statusesIndex(e.status)}>
              {e.status}
            </span>
            <dl>
              <dt>목표 연도</dt>
              <dd>{e.target_year}년</dd>
              <dt>예정 기간</dt>
              <dd>
                {e.start_date} ~ {e.end_date}
              </dd>
              <dt>실제 실행일</dt>
              <dd>{e.actual_date || "미입력"}</dd>
              <dt>결과</dt>
              <dd className="prose">{e.result || "아직 결과가 없습니다."}</dd>
              {e.completed_at && (
                <>
                  <dt>완료 처리</dt>
                  <dd>
                    {name(e.completed_by!)} ·{" "}
                    {new Date(e.completed_at).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </dd>
                </>
              )}
            </dl>
          </div>
          <h3>
            연결된 작업일지 <span className="count">{logs.length}</span>
          </h3>
          {logs.length ? (
            logs.map((l) => (
              <div className="linked-log" key={l.id}>
                <button className="text-button" onClick={() => onOpen(l)}>
                  {l.work_date} · {l.title}
                </button>
                <p className="prose">{l.body}</p>
                <div className="attachments">
                  {s.assets
                    .filter((a) => a.entry_id === l.id && a.ready)
                    .map((a) => (
                      <Attachment key={a.id} asset={a} />
                    ))}
                </div>
              </div>
            ))
          ) : (
            <p className="muted">
              연결된 작업일지가 없습니다. 일지 작성 시 이 계획을 선택해 주세요.
            </p>
          )}
        </>
      )}
      {e.url && safeUrl(e.url) && (
        <a
          className="external-link"
          href={safeUrl(e.url)!}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={17} />
          공유 링크 열기
        </a>
      )}
      <div className="attachments">
        {assets.map((a) => (
          <Attachment key={a.id} asset={a} />
        ))}
      </div>
      {(e.kind === "log" || e.kind === "resource") && !e.deleted_at && (
        <Discussion key={e.id} entry={e} me={me} members={s.members} />
      )}
      <p className="timestamp">
        작성{" "}
        {new Date(e.created_at).toLocaleString("ko-KR", {
          timeZone: "Asia/Seoul",
        })}
        <br />
        수정{" "}
        {new Date(e.updated_at).toLocaleString("ko-KR", {
          timeZone: "Asia/Seoul",
        })}{" "}
        · {name(e.updated_by)}
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {canEdit(me, e) && (
        <div className="dialog-footer">
          <button className="danger" disabled={busy} onClick={trash}>
            <Trash2 size={16} />
            휴지통으로
          </button>
          <button className="primary" onClick={onEdit}>
            <Pencil size={16} />
            수정하기
          </button>
        </div>
      )}
    </dialog>
  );
}
function statusesIndex(s: string) {
  return ["미실행", "진행중", "완료", "보류", "취소"].indexOf(s);
}
