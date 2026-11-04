import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { tcp, web, ping } = require("../app/probes.cjs");
const { validateToken } = require("../app/telegram.cjs");
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
const close = (server) => new Promise((resolve) => server.close(resolve));
test("TCP distinguishes a listening port from a closed port", async () => {
  const server = net.createServer((socket) => socket.end());
  const port = await listen(server);
  assert.equal((await tcp("127.0.0.1", port, 1000)).ok, true);
  await close(server);
  assert.equal((await tcp("127.0.0.1", port, 1000)).ok, false);
});
test("HTTP handles redirects, error status, and a total timeout", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/ok" });
      res.end();
    } else if (req.url === "/loop") {
      res.writeHead(302, { Location: "/loop" });
      res.end();
    } else if (req.url === "/fail") {
      res.writeHead(503);
      res.end();
    } else if (req.url === "/hang") {
    } else {
      res.writeHead(200);
      res.end("OK");
    }
  });
  const port = await listen(server),
    url = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await web(url + "/redirect", 1000)).ok, true);
    assert.equal((await web(url + "/fail", 1000)).detail, "HTTP 503");
    assert.equal((await web(url + "/loop", 1000)).ok, false);
    const start = Date.now();
    assert.equal((await web(url + "/hang", 150)).ok, false);
    assert.ok(Date.now() - start < 1000);
  } finally {
    server.closeAllConnections();
    await close(server);
  }
});
test(
  "native ICMP helper responds on Windows loopback",
  { skip: process.platform !== "win32" },
  async () => {
    const helper = fileURLToPath(
      new URL("../app/native/PingProbe.exe", import.meta.url),
    );
    const result = await ping("127.0.0.1", 1000, helper);
    assert.equal(result.ok, true);
    assert.equal(typeof result.latency, "number");
  },
);
test("invalid bot credentials never leave the process", () => {
  for (const token of ["", "https://example.com", "../secret", "123:abc"])
    assert.throws(() => validateToken(token));
});
