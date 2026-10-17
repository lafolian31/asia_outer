import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.test");
const source = {
  url: process.env.SUPABASE_URL,
  anon: process.env.SUPABASE_ANON_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
const target = Object.fromEntries(
  (await readFile(".env.restore-test", "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
assert.equal(source.url, "http://127.0.0.1:54321");
assert.equal(target.SUPABASE_URL, "http://127.0.0.1:54331");
const fixture = JSON.parse(await readFile(".env.test-fixtures.json", "utf8"));
const tmp = await mkdtemp(path.join(tmpdir(), "farm-backup-check-"));
const backupDir = path.join(tmp, "snapshot");
execFileSync(process.execPath, ["scripts/backup.mjs", backupDir], {
  env: {
    ...process.env,
    FARM_EMAIL: fixture.users.admin.email,
    FARM_PASSWORD: fixture.users.admin.password,
  },
  stdio: "pipe",
});
const manifest = JSON.parse(
  await readFile(path.join(backupDir, "manifest.json"), "utf8"),
);
assert.ok(manifest.entries.length > 0);
assert.ok(manifest.assets.some((a) => a.ready));
assert.ok(
  !/access_token|refresh_token|password|token_hash/.test(
    JSON.stringify(manifest),
  ),
);
const db = createClient(target.SUPABASE_URL, target.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const map = {},
  passwords = {};
for (const m of manifest.members) {
  const password = randomBytes(24).toString("hex");
  const { data, error } = await db.auth.admin.createUser({
    email: `restore-${m.user_id}@example.test`,
    password,
    email_confirm: true,
  });
  assert.ifError(error);
  map[m.user_id] = data.user.id;
  passwords[m.user_id] = password;
}
const mapFile = path.join(tmp, "user-map.json");
await writeFile(mapFile, JSON.stringify(map), { mode: 0o600 });
execFileSync(
  process.execPath,
  ["scripts/restore.mjs", backupDir, mapFile, "--empty-target-confirmed"],
  { env: { ...process.env, ...target }, stdio: "pipe" },
);
const records = await db.from("entries").select("*");
assert.ifError(records.error);
assert.equal(records.data.length, manifest.entries.length);
for (const e of manifest.entries) {
  const copy = records.data.find((x) => x.id === e.id);
  for (const key of [
    "title",
    "body",
    "plan_id",
    "work_date",
    "target_year",
    "status",
    "actual_date",
    "result",
    "version",
    "deleted_at",
  ])
    assert.equal(copy[key], e[key], key);
  assert.equal(copy.author_id, map[e.author_id]);
}
const memberResult = await db.from("members").select("*");
assert.ifError(memberResult.error);
for (const m of manifest.members) {
  const copy = memberResult.data.find((x) => x.user_id === map[m.user_id]);
  assert.equal(copy.role, m.role);
  assert.equal(copy.active, m.active);
}
const editor = createClient(target.SUPABASE_URL, target.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
assert.ifError(
  (
    await editor.auth.signInWithPassword({
      email: `restore-${fixture.users.a.id}@example.test`,
      password: passwords[fixture.users.a.id],
    })
  ).error,
);
for (const a of manifest.assets.filter((a) => a.ready)) {
  const r = await editor.storage.from("farm-files").download(a.path);
  assert.ifError(r.error);
  const hash = createHash("sha256")
    .update(Buffer.from(await r.data.arrayBuffer()))
    .digest("hex");
  assert.equal(hash, manifest.sha256[a.path]);
}
const other = manifest.entries.find(
  (e) => e.author_id !== fixture.users.a.id && !e.deleted_at,
);
const denied = await editor.rpc("save_entry", {
  p_id: other.id,
  p_version: other.version,
  p_data: { ...other, title: "권한 침범" },
});
assert.ok(denied.error);
const outsiderData = await db.auth.admin.createUser({
  email: `restore-outsider-${Date.now()}@example.test`,
  password: "Local-test-only-password-123!",
  email_confirm: true,
});
assert.ifError(outsiderData.error);
const outsider = createClient(target.SUPABASE_URL, target.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
assert.ifError(
  (
    await outsider.auth.signInWithPassword({
      email: outsiderData.data.user.email,
      password: "Local-test-only-password-123!",
    })
  ).error,
);
assert.equal((await outsider.from("entries").select("*")).data.length, 0);
assert.ok(
  (await outsider.storage.from("farm-files").download(fixture.asset.path))
    .error,
);
let refused = false;
try {
  execFileSync(
    process.execPath,
    ["scripts/restore.mjs", backupDir, mapFile, "--empty-target-confirmed"],
    { env: { ...process.env, ...target }, stdio: "pipe" },
  );
} catch {
  refused = true;
}
assert.ok(refused, "Nonempty restore target must be refused");
console.log(
  `PASS: independent backup/restore preserved ${records.data.length} records, ${manifest.assets.filter((a) => a.ready).length} files with SHA-256 verification, plan links and member roles. Nonmember and cross-author writes denied; nonempty target refused.`,
);
