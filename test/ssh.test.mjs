import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { ssh, tcp, probe } = require("../app/probes.cjs");
const {
  cleanMonitor,
  defaults,
  applyResult,
  freshState,
  shouldAlert,
} = require("../app/core.cjs");
async function fixture(handler, run) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    handler(socket);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(server.address().port);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}
test("SSH requires a service response even when a proxy accepts TCP", async () => {
  await fixture(
    () => {},
    async (port) => {
      assert.equal((await tcp("127.0.0.1", port, 500)).ok, true);
      const result = await probe(
        cleanMonitor({ type: "ssh", address: "127.0.0.1", port }),
        150,
      );
      assert.equal(result.ok, false);
      assert.equal(result.detail, "sshNoGreeting");
      assert.equal(result.latency, null);
      const state = freshState();
      applyResult(state, result, defaults);
      const event = applyResult(state, result, defaults);
      assert.equal(shouldAlert(event, defaults), false);
      assert.equal(state.status, "down");
    },
  );
});
test("SSH exchanges identification, accepts fragmented banners and preamble, and sends no credentials", async () => {
  let clientData = "";
  await fixture(
    (socket) => {
      socket.on("data", (data) => {
        clientData += data;
        if (clientData.endsWith("\n")) {
          socket.write("Welcome\r\nSSH-2.0-");
          setTimeout(() => socket.end("OpenSSH_test example\r\n"), 15);
        }
      });
    },
    async (port) => {
      const result = await ssh("127.0.0.1", port, 500);
      assert.equal(result.ok, true);
      assert.equal(result.detail, "sshGreeting");
      assert.equal(clientData, "SSH-2.0-PulseDeck\r\n");
    },
  );
});
test("SSH rejects wrong services, invalid and truncated greetings and excessive data", async () => {
  for (const reply of [
    "HTTP/1.1 200 OK\r\n\r\n",
    "SSH-1.5-old\r\n",
    "SSH-2.0-\r\n",
    "SSH-2.0-bad\0value\r\n",
    "SSH-2.0-truncated",
    "SSH-2.0-" + "x".repeat(250) + "\r\n",
    "x".repeat(9000),
  ]) {
    await fixture(
      (socket) => socket.end(reply),
      async (port) =>
        assert.equal((await ssh("127.0.0.1", port, 200)).ok, false),
    );
  }
});
test("SSH has a total deadline even if a peer keeps sending data", async () => {
  await fixture(
    (socket) => {
      const timer = setInterval(() => socket.write("x"), 20);
      socket.on("close", () => clearInterval(timer));
    },
    async (port) => {
      const start = Date.now();
      assert.equal((await ssh("127.0.0.1", port, 150)).ok, false);
      assert.ok(Date.now() - start < 1000);
    },
  );
});
test("SSH validates ports, preserves custom ports, and recognizes compatibility identification", async () => {
  assert.equal(cleanMonitor({ type: "ssh", address: "localhost" }).port, 22);
  assert.equal(
    cleanMonitor({ type: "ssh", address: "localhost", port: 2222 }).port,
    2222,
  );
  for (const port of [0, -1, 65536, 1.5, "bad"])
    assert.throws(() =>
      cleanMonitor({ type: "ssh", address: "localhost", port }),
    );
  await fixture(
    (socket) => socket.end("SSH-1.99-compatible\n"),
    async (port) => assert.equal((await ssh("127.0.0.1", port, 300)).ok, true),
  );
});
