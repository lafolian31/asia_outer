// Trusted operator only. Restore into a NEW/empty project with the migration applied.
// Existing auth accounts must be recreated first; user-map.json maps old UUID -> new UUID.
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  process.argv[4] !== "--empty-target-confirmed"
)
  throw Error(
    "Usage: secure env SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; node scripts/restore.mjs BACKUP_DIR USER_MAP_JSON --empty-target-confirmed",
  );
const base = path.resolve(process.argv[2]),
  manifest = JSON.parse(
    await readFile(path.join(base, "manifest.json"), "utf8"),
  ),
  mapping = JSON.parse(await readFile(process.argv[3], "utf8"));
if (manifest.format !== 1) throw Error("Unsupported backup format");
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const check = (r) => {
  if (r.error) throw r.error;
  return r.data;
};
for (const table of [
  "members",
  "entries",
  "assets",
  "entry_comments",
  "entry_reactions",
  "accounting_roles",
  "accounting_imports",
  "accounting_transactions",
  "accounting_import_items",
  "accounting_audit",
]) {
  const r = await db.from(table).select("*", { count: "exact", head: true });
  check(r);
  if (r.count) throw Error("Restore requires an empty target: " + table);
}
const remap = (id) => {
  if (!id) return null;
  const value = mapping[id];
  if (!value) throw Error("Missing account mapping: " + id);
  return value;
};
for (const m of manifest.members) {
  remap(m.user_id);
  const r = await db.auth.admin.getUserById(mapping[m.user_id]);
  check(r);
}
if (!manifest.members.some((m) => m.role === "admin" && m.active))
  throw Error("Backup has no active administrator");
// Validate all files and actor mappings before changing target data.
for (const e of manifest.entries)
  for (const key of [
    "author_id",
    "updated_by",
    "completed_by",
    "deleted_by",
    "assignee",
  ])
    remap(e[key]);
for (const e of manifest.entries)
  for (const id of e.participant_ids || []) remap(id);
for (const c of manifest.comments || []) {
  remap(c.author_id);
  remap(c.updated_by);
}
for (const r of manifest.reactions || []) remap(r.user_id);
if (manifest.accounting) {
  if (manifest.accounting.format !== 1)
    throw Error("Unsupported accounting backup format");
  remap(manifest.accounting.settings.updated_by);
  for (const r of manifest.accounting.roles) {
    remap(r.user_id);
    remap(r.granted_by);
  }
  for (const r of manifest.accounting.imports) {
    remap(r.created_by);
    remap(r.cancelled_by);
  }
  for (const r of manifest.accounting.transactions) remap(r.updated_by);
  for (const r of manifest.accounting.audit) {
    remap(r.actor_id);
    if (r.entity === "treasurer") remap(r.entity_id);
  }
}
for (const a of manifest.assets.filter((a) => a.ready)) {
  remap(a.author_id);
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(a.path))
    throw Error("Unsafe file path");
  const bytes = await readFile(path.join(base, "files", a.path));
  if (bytes.length !== a.size) throw Error("Backup size mismatch: " + a.name);
  if (
    manifest.sha256?.[a.path] &&
    createHash("sha256").update(bytes).digest("hex") !== manifest.sha256[a.path]
  )
    throw Error("Backup checksum mismatch: " + a.name);
}
check(
  await db
    .from("members")
    .insert(manifest.members.map((m) => ({ ...m, user_id: remap(m.user_id) }))),
);
check(
  await db
    .from("farm_settings")
    .update({
      name: manifest.settings.name,
      zones: manifest.settings.zones,
      crops: manifest.settings.crops,
      resource_categories: manifest.settings.resource_categories || ["일반"],
      ...(manifest.settings.multi_recording ? { multi_recording: true } : {}),
      ...(manifest.settings.work_catalog
        ? { work_catalog: manifest.settings.work_catalog }
        : {}),
      version: manifest.settings.version,
    })
    .eq("id", true),
);
const entries = manifest.entries.map((e) => ({
  ...e,
  author_id: remap(e.author_id),
  updated_by: remap(e.updated_by),
  completed_by: remap(e.completed_by),
  deleted_by: remap(e.deleted_by),
  assignee: remap(e.assignee),
  participant_ids: (e.participant_ids || []).map(remap),
}));
for (const group of [
  entries.filter((e) => e.kind === "plan"),
  entries.filter((e) => e.kind !== "plan"),
])
  for (let i = 0; i < group.length; i += 100)
    check(await db.from("entries").insert(group.slice(i, i + 100)));
for (const [table, rows] of [
  [
    "entry_comments",
    (manifest.comments || []).map((c) => ({
      ...c,
      author_id: remap(c.author_id),
      updated_by: remap(c.updated_by),
    })),
  ],
  [
    "entry_reactions",
    (manifest.reactions || []).map((r) => ({
      ...r,
      user_id: remap(r.user_id),
    })),
  ],
]) {
  for (let i = 0; i < rows.length; i += 100)
    check(await db.from(table).insert(rows.slice(i, i + 100)));
}
for (const a of manifest.assets.filter((a) => a.ready)) {
  check(
    await db.from("assets").insert({ ...a, author_id: remap(a.author_id) }),
  );
  check(
    await db.storage
      .from("farm-files")
      .upload(a.path, await readFile(path.join(base, "files", a.path)), {
        contentType: a.mime,
        upsert: false,
      }),
  );
}
if (manifest.accounting) {
  const finance = manifest.accounting;
  // Target emptiness was checked above. Replace only seeded default finance categories.
  check(await db.from("accounting_categories").delete().not("id", "is", null));
  check(
    await db
      .from("accounting_settings")
      .update({
        ...finance.settings,
        updated_by: remap(finance.settings.updated_by),
      })
      .eq("id", true),
  );
  const groups = [
    ["accounting_categories", finance.categories],
    [
      "accounting_roles",
      finance.roles.map((r) => ({
        ...r,
        user_id: remap(r.user_id),
        granted_by: remap(r.granted_by),
      })),
    ],
    [
      "accounting_imports",
      finance.imports.map((r) => ({
        ...r,
        created_by: remap(r.created_by),
        cancelled_by: remap(r.cancelled_by),
      })),
    ],
    [
      "accounting_transactions",
      finance.transactions.map((r) => ({
        ...r,
        updated_by: remap(r.updated_by),
      })),
    ],
    ["accounting_import_items", finance.items],
    [
      "accounting_audit",
      finance.audit.map((r) => ({
        ...r,
        actor_id: remap(r.actor_id),
        entity_id: r.entity === "treasurer" ? remap(r.entity_id) : r.entity_id,
      })),
    ],
  ];
  for (const [table, rows] of groups)
    for (let i = 0; i < rows.length; i += 100)
      check(await db.from(table).insert(rows.slice(i, i + 100)));
}
// Historical audit is retained in the backup; restore-generated audit is kept in the new project.
console.log(
  `Restored ${entries.length} records and ${manifest.assets.filter((a) => a.ready).length} files. Verify member permissions and downloads before opening access. Original audit is in manifest.json.`,
);
