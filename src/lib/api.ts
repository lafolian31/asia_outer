import { createClient } from "@supabase/supabase-js";
import type { Asset, Entry, Member, Settings, Snapshot } from "./types";
import { plansOf, cropsOf, zonesOf, groupsOf, tasksOf, hasPlan } from "./work";
import { normalizeAttachment } from "./files.js";
import { csv, download } from "./utils.js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = !!url && !!key && !url.includes("YOUR-PROJECT");
export const db = createClient(
  configured ? url : "http://127.0.0.1:54321",
  configured ? key : "not-configured",
);
export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data as T;
}
export async function all<T>(table: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .order(
        table === "members"
          ? "user_id"
          : table === "farm_settings"
            ? "id"
            : "id",
      )
      .range(from, from + 499);
    if (error) throw error;
    rows.push(...(data as T[]));
    if (data.length < 500) return rows;
  }
}
export async function optionalAll<T>(table: string): Promise<T[]> {
  try {
    return await all<T>(table);
  } catch (error: any) {
    if (["42P01", "PGRST205"].includes(error?.code)) return [];
    throw error;
  }
}
export async function snapshot(): Promise<Snapshot> {
  const [entries, members, assets, settings] = await Promise.all([
    all<Entry>("entries"),
    all<Member>("members"),
    all<Asset>("assets"),
    all<Settings>("farm_settings"),
  ]);
  if (!settings[0])
    throw new Error("농장 참여 승인이 필요하거나 접근 권한이 해제되었습니다.");
  return { entries, members, assets, settings: settings[0] };
}
export async function compressPhoto(file: File): Promise<File> {
  file = normalizeAttachment(file);
  if (!file.type.startsWith("image/")) return file;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "사진은 JPG, PNG, WebP를 사용해 주세요. HEIC는 JPG로 변환해 주세요.",
    );
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "사진을 읽을 수 없습니다. 파일이 손상되지 않았는지 확인하고 JPG·PNG·WebP 사진을 다시 선택해 주세요.",
    );
  }
  const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("사진 압축에 실패했습니다."))),
      "image/jpeg",
      0.78,
    ),
  );
  if (blob.size > 2097152)
    throw new Error(
      "압축 후 사진이 2MB를 초과했습니다. 더 작은 사진을 선택해 주세요.",
    );
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
    type: "image/jpeg",
  });
}
export async function upload(entryId: string, file: File) {
  file = normalizeAttachment(file);
  if (file.size > 10485760)
    throw new Error("파일은 10MB 이하로 선택해 주세요.");
  const id = crypto.randomUUID();
  const a = await rpc<Asset>("reserve_asset", {
    p_id: id,
    p_entry: entryId,
    p_name: file.name,
    p_mime: file.type || "application/octet-stream",
    p_size: file.size,
  });
  const { error } = await db.storage
    .from("farm-files")
    .upload(a.path, file, { contentType: a.mime, upsert: false });
  if (error) {
    await rpc("cancel_asset", { p_id: id }).catch(() => {});
    throw error;
  }
  try {
    await rpc("finish_asset", { p_id: id });
  } catch (error) {
    await db.storage.from("farm-files").remove([a.path]);
    await rpc("cancel_asset", { p_id: id }).catch(() => {});
    throw error;
  }
}
export async function fileBlob(asset: Asset) {
  const { data, error } = await db.storage
    .from("farm-files")
    .download(asset.path);
  if (error) throw error;
  return data;
}
export async function purge(entry: Entry, assets: Asset[], entries: Entry[]) {
  if (entries.some((e) => hasPlan(e, entry.id)))
    throw new Error(
      "연결된 일지를 먼저 분리해야 계획을 영구 삭제할 수 있습니다.",
    );
  const paths = assets
    .filter((a) => a.entry_id === entry.id)
    .map((a) => a.path);
  if (paths.length) {
    const { error } = await db.storage.from("farm-files").remove(paths);
    if (error) throw error;
  }
  await rpc("purge_entry", { p_id: entry.id });
}
export function exportCsv(s: Snapshot) {
  const name = (id: string) =>
    s.members.find((m) => m.user_id === id)?.display_name || id;
  const rows = [
    [
      "종류",
      "제목",
      "내용",
      "작업일",
      "목표연도",
      "예정시작",
      "예정종료",
      "상태",
      "실제실행일",
      "결과",
      "연결계획",
      "작성자",
      "구역",
      "작물",
      "분류",
      "링크",
      "작성시각",
      "수정시각",
      "완료처리자",
      "완료처리시각",
      "삭제시각",
      "기록구분",
      "작업대분류",
      "세부작업",
      "활동분류",
      "작업량",
      "단위",
      "참여자",
    ],
    ...s.entries.map((e) => [
      e.kind === "log"
        ? e.record_type === "activity"
          ? "운영·교류"
          : "농작업일지"
        : e.kind === "plan"
          ? "농장계획"
          : "자료",
      e.title,
      e.body,
      e.work_date,
      e.target_year,
      e.start_date,
      e.end_date,
      e.status,
      e.actual_date,
      e.result,
      plansOf(e)
        .map((id) => s.entries.find((p) => p.id === id)?.title || "이전 계획")
        .join(", "),
      name(e.author_id),
      zonesOf(e).join(", "),
      cropsOf(e).join(", "),
      e.category,
      e.url,
      e.created_at,
      e.updated_at,
      e.completed_by ? name(e.completed_by) : "",
      e.completed_at,
      e.deleted_at,
      e.record_type || "",
      groupsOf(e).join(", "),
      tasksOf(e)
        .map((w) => `${w.group}: ${w.task}`)
        .join(", "),
      e.activity_category || "",
      e.quantity ?? "",
      e.quantity_unit || "",
      (e.participant_ids || []).map(name).join(", "),
    ]),
  ];
  download(
    new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }),
    "농장기록.csv",
  );
}
export async function backup(s: Snapshot) {
  const { zipSync, strToU8 } = await import("fflate");
  const assets = s.assets.filter((a) => a.ready);
  if (assets.reduce((n, a) => n + a.size, 0) > 100000000)
    throw new Error(
      "100MB 이상 백업은 PC에서 운영 안내의 백업 명령을 사용해 주세요.",
    );
  const [audit, comments, reactions] = await Promise.all([
    all("audit_log"),
    optionalAll("entry_comments"),
    optionalAll("entry_reactions"),
  ]);
  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(
      JSON.stringify(
        {
          format: 1,
          exported_at: new Date().toISOString(),
          ...s,
          audit,
          comments,
          reactions,
        },
        null,
        2,
      ),
    ),
  };
  for (const a of assets)
    files["files/" + a.path] = new Uint8Array(
      await (await fileBlob(a)).arrayBuffer(),
    );
  const [latest, latestComments, latestReactions] = await Promise.all([
    snapshot(),
    optionalAll("entry_comments"),
    optionalAll("entry_reactions"),
  ]);
  if (
    JSON.stringify(latest.entries.map((e) => [e.id, e.version])) !==
      JSON.stringify(s.entries.map((e) => [e.id, e.version])) ||
    JSON.stringify(latest.assets) !== JSON.stringify(s.assets) ||
    JSON.stringify(latestComments) !== JSON.stringify(comments) ||
    JSON.stringify(latestReactions) !== JSON.stringify(reactions)
  )
    throw new Error(
      "백업 도중 기록이 바뀌었습니다. 잠시 편집을 멈추고 다시 백업해 주세요.",
    );
  const bytes = zipSync(files, { level: 0 });
  download(
    new Blob([bytes as BlobPart], { type: "application/zip" }),
    "농장백업-" + new Date().toISOString().slice(0, 10) + ".zip",
  );
}
