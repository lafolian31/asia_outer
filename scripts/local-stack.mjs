// TEST ONLY. Starts real Postgres, Supabase Auth/Storage, and PostgREST using modest disk space.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes, createHmac } from "node:crypto";
const replica = process.env.FARM_LOCAL_INSTANCE === "restore";
const prefix = replica ? "farm-test-restore" : "farm-test";
const apiPort = replica ? 54331 : 54321;
const portBase = replica ? 55442 : 55432;
const configFile = replica
  ? ".env.restore-stack.json"
  : ".env.local-stack.json";
const pidFile = replica ? ".env.restore-stack-pid" : ".env.local-stack-pid";
const names = ["db", "auth", "rest", "storage"];
const docker = (args, options = {}) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
const exists = (n) => {
  try {
    docker(["inspect", prefix + "-" + n]);
    return true;
  } catch {
    return false;
  }
};
const sql = (text) =>
  docker(
    [
      "exec",
      "-i",
      prefix + "-db",
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: text },
  );
if (process.argv[2] === "stop" || process.argv[2] === "reset") {
  for (const n of names.reverse())
    if (exists(n)) {
      docker(
        process.argv[2] === "reset"
          ? ["rm", "-f", prefix + "-" + n]
          : ["stop", prefix + "-" + n],
      );
    }
  if (existsSync(pidFile)) {
    try {
      const pid = Number(readFileSync(pidFile, "utf8"));
      if (
        readFileSync("/proc/" + pid + "/cmdline", "utf8").includes(
          "scripts/local-gateway.mjs",
        )
      )
        process.kill(pid);
    } catch {}
  }
  if (process.argv[2] === "reset") {
    for (const n of ["db", "files"]) {
      try {
        docker(["volume", "rm", prefix + "-" + n]);
      } catch {}
    }
    console.log("Only farm-test local containers and volumes removed.");
  } else console.log("Local test containers stopped; data volumes retained.");
  process.exit(0);
}
let config;
if (existsSync(configFile))
  config = JSON.parse(readFileSync(configFile, "utf8"));
else {
  const secret = randomBytes(32).toString("hex");
  const token = (role) => {
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        role,
        iss: "supabase",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 315360000,
      }),
    ).toString("base64url");
    return (
      header +
      "." +
      body +
      "." +
      createHmac("sha256", secret)
        .update(header + "." + body)
        .digest("base64url")
    );
  };
  config = {
    secret,
    dbPassword: randomBytes(24).toString("hex"),
    anon: token("anon"),
    service: token("service_role"),
  };
  writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
}
try {
  docker(["network", "inspect", prefix]);
} catch {
  docker(["network", "create", prefix]);
}
const dbUrl = `postgresql://postgres:${config.dbPassword}@${prefix}-db:5432/postgres`;
function run(name, image, env, port, vol) {
  if (exists(name)) {
    docker(["start", prefix + "-" + name]);
    return false;
  }
  const args = [
    "run",
    "-d",
    "--name",
    prefix + "-" + name,
    "--network",
    prefix,
    "--label",
    "farm.test=true",
  ];
  if (port) args.push("-p", `127.0.0.1:${port}`);
  if (vol) args.push("-v", vol);
  for (const [k, v] of Object.entries(env)) args.push("-e", k + "=" + v);
  args.push(image);
  docker(args);
  console.log(name + " started");
  return true;
}
run(
  "db",
  "postgres:17-alpine",
  { POSTGRES_PASSWORD: config.dbPassword },
  `${portBase}:5432`,
  prefix + "-db:/var/lib/postgresql/data",
);
const pause = () => new Promise((r) => setTimeout(r, 500));
for (let i = 0; i < 60; i++) {
  try {
    docker(["exec", prefix + "-db", "pg_isready", "-U", "postgres"]);
    break;
  } catch {
    await pause();
  }
}
const fresh =
  docker([
    "exec",
    prefix + "-db",
    "psql",
    "-U",
    "postgres",
    "-Atc",
    "select exists(select 1 from pg_roles where rolname='authenticated')",
  ]).trim() !== "t";
if (fresh) sql(readFileSync("scripts/local-bootstrap.sql", "utf8"));
run(
  "auth",
  "supabase/gotrue:v2.180.0",
  {
    GOTRUE_API_HOST: "0.0.0.0",
    GOTRUE_API_PORT: "9999",
    API_EXTERNAL_URL: `http://127.0.0.1:${apiPort}`,
    GOTRUE_SITE_URL: "http://127.0.0.1:5173",
    GOTRUE_DB_DRIVER: "postgres",
    GOTRUE_DB_DATABASE_URL: dbUrl + "?search_path=auth",
    GOTRUE_JWT_SECRET: config.secret,
    GOTRUE_JWT_EXP: "3600",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_DISABLE_SIGNUP: "true",
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
    GOTRUE_MAILER_AUTOCONFIRM: "true",
    GOTRUE_PASSWORD_MIN_LENGTH: "12",
  },
  `${portBase + 1}:9999`,
);
run(
  "rest",
  "postgrest/postgrest:v13.0.7",
  {
    PGRST_DB_URI: dbUrl,
    PGRST_DB_SCHEMAS: "public,storage",
    PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: config.secret,
    PGRST_DB_MAX_ROWS: "1000",
  },
  `${portBase + 2}:3000`,
);
run(
  "storage",
  "supabase/storage-api:v1.28.2",
  {
    ANON_KEY: config.anon,
    SERVICE_KEY: config.service,
    AUTH_JWT_SECRET: config.secret,
    DATABASE_URL: dbUrl,
    POSTGREST_URL: "http://" + prefix + "-rest:3000",
    FILE_SIZE_LIMIT: "10485760",
    STORAGE_BACKEND: "file",
    FILE_STORAGE_BACKEND_PATH: "/var/lib/storage",
    TENANT_ID: "farm-test",
    REGION: "local",
    GLOBAL_S3_BUCKET: "farm-test",
    ENABLE_IMAGE_TRANSFORMATION: "false",
  },
  `${portBase + 3}:5000`,
  prefix + "-files:/var/lib/storage",
);
for (const port of [portBase + 1, portBase + 2, portBase + 3]) {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/${port === portBase + 1 ? "health" : port === portBase + 3 ? "status" : ""}`,
      );
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
    await pause();
  }
  if (!ready) throw new Error("Local service not ready: " + port);
}
sql(readFileSync("scripts/local-storage-grants.sql", "utf8"));
const schemaInstalled =
  docker([
    "exec",
    prefix + "-db",
    "psql",
    "-U",
    "postgres",
    "-Atc",
    "select exists(select 1 from pg_trigger where tgname='check_farm_asset_bytes')",
  ]).trim() === "t";
if (!schemaInstalled) {
  sql(
    "begin;\n" +
      readFileSync("supabase/migrations/202610160001_farm.sql", "utf8") +
      "\ncommit;",
  );
  sql("NOTIFY pgrst,'reload schema';");
}
writeFileSync(
  replica ? ".env.restore-test" : ".env.test",
  `SUPABASE_URL=http://127.0.0.1:${apiPort}\nSUPABASE_ANON_KEY=${config.anon}\nSUPABASE_SERVICE_ROLE_KEY=${config.service}\n`,
  { mode: 0o600 },
);
if (!replica && !existsSync(".env.local"))
  writeFileSync(
    ".env.local",
    `VITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_ANON_KEY=${config.anon}\n`,
    { mode: 0o600 },
  );
try {
  await fetch(`http://127.0.0.1:${apiPort}/health`).then((r) => {
    if (!r.ok) throw Error();
  });
} catch {
  const child = spawn(
    process.execPath,
    [
      "scripts/local-gateway.mjs",
      String(apiPort),
      String(portBase + 1),
      String(portBase + 2),
      String(portBase + 3),
    ],
    { stdio: "ignore", detached: true },
  );
  child.unref();
  writeFileSync(pidFile, String(child.pid));
}
let gatewayReady = false;
for (let i = 0; i < 20; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${apiPort}/health`)).ok) {
      gatewayReady = true;
      break;
    }
  } catch {}
  await pause();
}
if (!gatewayReady) throw new Error("Local API gateway did not become ready.");
console.log("Local test services ready. No hosted project was modified.");
