// A normal farm admin account is required. No service key is used for backups.
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const { SUPABASE_URL, SUPABASE_ANON_KEY, FARM_EMAIL, FARM_PASSWORD } =
  process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !FARM_EMAIL || !FARM_PASSWORD)
  throw Error(
    "Set SUPABASE_URL, SUPABASE_ANON_KEY, FARM_EMAIL, FARM_PASSWORD in your secure environment.",
  );
const out = path.resolve(
  process.argv[2] ||
    `backups/farm-${new Date().toISOString().replaceAll(":", "-")}`,
);
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: true },
});
try {
  const login = await db.auth.signInWithPassword({
    email: FARM_EMAIL,
    password: FARM_PASSWORD,
  });
  if (login.error) throw login.error;
  const role = await db.rpc("my_role");
  if (role.data !== "admin")
    throw Error("Only an active farm administrator can make a full backup.");
  async function all(table) {
    const rows = [];
    for (let start = 0; ; start += 500) {
      const r = await db
        .from(table)
        .select("*")
        .order(table === "members" ? "user_id" : "id")
        .range(start, start + 499);
      if (r.error) throw r.error;
      rows.push(...r.data);
      if (r.data.length < 500) return rows;
    }
  }
  const [entries, members, assets, settings, audit] = await Promise.all(
    ["entries", "members", "assets", "farm_settings", "audit_log"].map(all),
  );
  const manifest = {
    format: 1,
    exported_at: new Date().toISOString(),
    entries,
    members,
    assets,
    settings: settings[0],
    audit,
    sha256: {},
  };
  await mkdir(out, { recursive: false, mode: 0o700 });
  for (const a of assets.filter((a) => a.ready)) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(a.path))
      throw Error("Unsafe asset path");
    const r = await db.storage.from("farm-files").download(a.path);
    if (r.error) throw r.error;
    const bytes = Buffer.from(await r.data.arrayBuffer());
    if (bytes.length !== a.size) throw Error("Downloaded file size mismatch");
    const dest = path.join(out, "files", a.path);
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    await writeFile(dest, bytes, { mode: 0o600 });
    manifest.sha256[a.path] = createHash("sha256").update(bytes).digest("hex");
  }
  // Detect changes during download. Backup fails closed instead of presenting a mixed snapshot as complete.
  const after = await all("entries");
  const afterAssets = await all("assets");
  if (
    JSON.stringify(after.map((e) => [e.id, e.version])) !==
      JSON.stringify(entries.map((e) => [e.id, e.version])) ||
    JSON.stringify(afterAssets) !== JSON.stringify(assets)
  )
    throw Error(
      "Records changed during backup. Ask participants to pause edits and run again into a new directory.",
    );
  await writeFile(
    path.join(out, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 },
  );
  console.log(
    `Backup completed: ${entries.length} records, ${assets.filter((a) => a.ready).length} files. Destination: ${out}`,
  );
} finally {
  await db.auth.signOut();
}
