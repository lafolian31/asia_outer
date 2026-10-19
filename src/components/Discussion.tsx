import { useCallback, useEffect, useRef, useState } from "react";
import { db, rpc } from "../lib/api";
import type {
  Comment,
  Entry,
  Member,
  Reaction,
  ReactionKind,
} from "../lib/types";
import { canEdit, readableError } from "../lib/utils.js";

const reactions: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: "like", emoji: "👍", label: "좋아요" },
  { kind: "love", emoji: "❤️", label: "사랑해요" },
  { kind: "laugh", emoji: "😂", label: "웃겨요" },
  { kind: "wow", emoji: "😮", label: "놀람" },
];
const time = (value: string) =>
  new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

export function Discussion({
  entry,
  me,
  members,
}: {
  entry: Entry;
  me: Member;
  members: Member[];
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [votes, setVotes] = useState<Reaction[]>([]);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<Comment | null>(null);
  const pendingId = useRef(crypto.randomUUID());
  const working = useRef(false);
  const alive = useRef(true);
  const writable = me.role !== "viewer" && !entry.deleted_at;
  const load = useCallback(async () => {
    async function rows<T>(table: string) {
      const result: T[] = [];
      for (let start = 0; ; start += 500) {
        const { data, error } = await db
          .from(table)
          .select("*")
          .eq("entry_id", entry.id)
          .order("id")
          .range(start, start + 499);
        if (error) throw error;
        result.push(...(data as T[]));
        if (data.length < 500) return result;
      }
    }
    try {
      const [c, r] = await Promise.all([
        rows<Comment>("entry_comments"),
        rows<Reaction>("entry_reactions"),
      ]);
      if (!alive.current) return;
      setComments(
        c
          .filter((item) => !item.deleted_at)
          .sort(
            (a, b) =>
              a.created_at.localeCompare(b.created_at) ||
              a.id.localeCompare(b.id),
          ),
      );
      setVotes(r);
      setAvailable(true);
      setReady(true);
    } catch (err: any) {
      if (!alive.current) return;
      if (["42P01", "PGRST205"].includes(err?.code)) {
        setAvailable(false);
        setReady(true);
        return;
      }
      // Clear previously loaded discussion if membership or parent access was lost.
      setComments([]);
      setVotes([]);
      setReady(false);
      throw err;
    }
  }, [entry.id]);
  useEffect(() => {
    alive.current = true;
    const refresh = () => {
      if (document.visibilityState === "visible")
        load().catch((e) => {
          if (alive.current) setError(readableError(e));
        });
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  async function act(fn: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      if (alive.current) setError(readableError(err));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    await act(async () => {
      await rpc("save_comment", {
        p_id: editing?.id || pendingId.current,
        p_entry: entry.id,
        p_version: editing?.version || 0,
        p_body: body,
      });
      setBody("");
      setEditing(null);
      pendingId.current = crypto.randomUUID();
    });
  }
  const own = votes.find((v) => v.user_id === me.user_id)?.kind;
  const name = (id: string) =>
    members.find((m) => m.user_id === id)?.display_name || "이전 참여자";
  return (
    <section className="discussion" aria-label="감정표현과 댓글">
      <h3>감정표현</h3>
      {!available ? (
        <p className="muted">
          감정표현과 댓글을 사용하려면 관리자가 데이터베이스 업데이트를 적용해야
          합니다.
        </p>
      ) : (
        <>
          <div className="reaction-list">
            {reactions.map((r) => (
              <button
                type="button"
                key={r.kind}
                aria-pressed={own === r.kind}
                disabled={!writable || !ready || busy}
                onClick={() =>
                  act(async () => {
                    await rpc("set_reaction", {
                      p_entry: entry.id,
                      p_kind: own === r.kind ? null : r.kind,
                    });
                  })
                }
              >
                <span aria-hidden="true">{r.emoji}</span> {r.label}{" "}
                <span>{votes.filter((v) => v.kind === r.kind).length}</span>
              </button>
            ))}
          </div>
          <div className="section-heading">
            <h3>
              댓글 <span className="count">{comments.length}</span>
            </h3>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => act(async () => {})}
            >
              댓글 새로고침
            </button>
          </div>
          {!ready && <p className="muted">댓글을 불러오는 중입니다.</p>}
          {ready && !comments.length && (
            <p className="muted">아직 댓글이 없습니다.</p>
          )}
          {comments.map((c) => (
            <article
              className="comment"
              key={c.id}
              aria-label={`${name(c.author_id)}의 댓글`}
            >
              <div className="comment-meta">
                <strong>{name(c.author_id)}</strong>
                <small>
                  {time(c.created_at)}
                  {c.version > 1 && ` · 수정 ${time(c.updated_at)}`}
                </small>
              </div>
              <p className="prose">{c.body}</p>
              {writable && canEdit(me, c) && (
                <div className="button-row">
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(c);
                      setBody(c.body);
                    }}
                  >
                    댓글 수정
                  </button>
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm("이 댓글을 삭제할까요?"))
                        act(async () => {
                          await rpc("delete_comment", {
                            p_id: c.id,
                            p_version: c.version,
                          });
                          if (editing?.id === c.id) {
                            setEditing(null);
                            setBody("");
                          }
                        });
                    }}
                  >
                    댓글 삭제
                  </button>
                </div>
              )}
            </article>
          ))}
          {writable ? (
            <form
              className="comment-form"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <label>
                {editing ? "댓글 수정 내용" : "댓글 내용"}
                <textarea
                  aria-label={editing ? "댓글 수정 내용" : "댓글 내용"}
                  required
                  disabled={busy}
                  maxLength={5000}
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="함께 나눌 이야기를 남겨 주세요."
                />
              </label>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy || !ready || !body.trim()}
                >
                  {editing ? "댓글 수정 저장" : "댓글 등록"}
                </button>
                {editing && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(null);
                      setBody("");
                    }}
                  >
                    수정 취소
                  </button>
                )}
              </div>
            </form>
          ) : (
            <p className="muted">
              열람자는 감정표현과 댓글을 볼 수 있습니다. 작성은 참여자와
              관리자만 가능합니다.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
