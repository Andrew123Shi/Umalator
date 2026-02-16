const { app, BrowserWindow, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const MIME_TYPES = {
  ".html": "text/html; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".js": "text/javascript; charset=UTF-8",
  ".json": "application/json; charset=UTF-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const APP_ROOT = path.resolve(__dirname, "..");
const GLOBAL_DIR = path.join(APP_ROOT, "umalator-global");
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 20000;

const HEARTBEAT_SCRIPT = `<script>
(() => {
  const intervalMs = ${HEARTBEAT_INTERVAL_MS};
  const ping = () => {
    fetch('/__heartbeat?t=' + Date.now(), { cache: 'no-store' }).catch(() => {});
  };
  ping();
  const timer = setInterval(ping, intervalMs);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
})();
</script>`;

function safeResolve(baseDir, requestPath) {
  const resolved = path.resolve(baseDir, requestPath);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    return null;
  }
  return resolved;
}

function serveFile(filePath, res) {
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404).end();
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Content-Length": stat.size });
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveHtmlWithHeartbeat(filePath, res) {
  fs.readFile(filePath, "utf8", (error, html) => {
    if (error) {
      res.writeHead(404).end();
      return;
    }

    const output = html.includes("</body>")
      ? html.replace("</body>", `${HEARTBEAT_SCRIPT}\n</body>`)
      : `${html}\n${HEARTBEAT_SCRIPT}\n`;
    const body = Buffer.from(output, "utf8");
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[".html"],
      "Content-Length": body.length
    });
    res.end(body);
  });
}

function createLocalServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const method = req.method || "GET";
      if (method !== "GET" && method !== "HEAD") {
        res.writeHead(405).end();
        return;
      }

      const url = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === "/__heartbeat") {
        lastHeartbeatAt = Date.now();
        res.writeHead(204).end();
        return;
      }
      const normalizedPath = pathname === "/" ? "/index.html" : pathname;

      const stripped = normalizedPath.replace(/^\/+/, "");
      const rootRelative = stripped.startsWith("uma-tools/");
      const requestPath = rootRelative ? stripped.slice("uma-tools/".length) : stripped;
      const baseDir = rootRelative ? APP_ROOT : GLOBAL_DIR;
      const filePath = safeResolve(baseDir, requestPath);

      if (!filePath) {
        res.writeHead(400).end();
        return;
      }

      if (method === "HEAD") {
        fs.stat(filePath, (error, stat) => {
          if (error || !stat.isFile()) {
            res.writeHead(404).end();
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          res.writeHead(200, { "Content-Type": contentType, "Content-Length": stat.size }).end();
        });
        return;
      }

      if (requestPath === "index.html" && baseDir === GLOBAL_DIR) {
        serveHtmlWithHeartbeat(filePath, res);
        return;
      }

      serveFile(filePath, res);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to start local server"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

let localServer;
let openedUrl = null;
let keepAliveWindow = null;
let heartbeatCheckTimer = null;
let lastHeartbeatAt = 0;

function startHeartbeatMonitor() {
  lastHeartbeatAt = Date.now();
  if (heartbeatCheckTimer) {
    clearInterval(heartbeatCheckTimer);
  }
  heartbeatCheckTimer = setInterval(() => {
    if (Date.now() - lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
      app.quit();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

async function startServerAndOpenBrowser() {
  const { server, port } = await createLocalServer();
  localServer = server;
  startHeartbeatMonitor();
  keepAliveWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await keepAliveWindow.loadURL("about:blank");
  openedUrl = `http://127.0.0.1:${port}/`;
  await shell.openExternal(openedUrl);
}

app.whenReady().then(startServerAndOpenBrowser).catch(error => {
  console.error(error);
  app.quit();
});

app.on("before-quit", () => {
  if (heartbeatCheckTimer) {
    clearInterval(heartbeatCheckTimer);
    heartbeatCheckTimer = null;
  }
  if (keepAliveWindow) {
    keepAliveWindow.destroy();
    keepAliveWindow = null;
  }
  if (localServer) {
    localServer.close();
    localServer = null;
  }
});

app.on("activate", async () => {
  if (openedUrl) {
    await shell.openExternal(openedUrl);
  }
});
