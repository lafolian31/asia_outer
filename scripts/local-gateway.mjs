// Loopback-only development gateway. Production uses the hosted Supabase API.
import http from "node:http";
const [
  apiPort = 54321,
  authPort = 55433,
  restPort = 55434,
  storagePort = 55435,
] = process.argv.slice(2).map(Number);
http
  .createServer((req, res) => {
    const cors = {
      "access-control-allow-origin": "http://127.0.0.1:5173",
      "access-control-allow-headers":
        req.headers["access-control-request-headers"] ||
        "authorization,apikey,content-type,accept-profile,content-profile,x-client-info,x-supabase-api-version,x-upsert,cache-control,x-retry-count",
      "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, cors);
      res.end("ok");
      return;
    }
    const route = [
      ["/auth/v1", authPort],
      ["/rest/v1", restPort],
      ["/storage/v1", storagePort],
    ].find(([prefix]) => req.url.startsWith(prefix));
    if (!route) {
      res.writeHead(404, cors);
      res.end();
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: route[1],
        path: req.url.slice(route[0].length) || "/",
        method: req.method,
        headers: { ...req.headers, host: "127.0.0.1" },
      },
      (reply) => {
        res.writeHead(reply.statusCode, { ...reply.headers, ...cors });
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502, cors);
      res.end("Local service unavailable");
    });
    req.pipe(upstream);
  })
  .listen(apiPort, "127.0.0.1");
