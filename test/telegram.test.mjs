import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { call } = require("../app/telegram.cjs");
const token = "123456789:" + "x".repeat(35);
function transport(result, capture) {
  return (options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = (body) => {
      capture?.(options, JSON.parse(body));
      setImmediate(() => {
        const response = new EventEmitter();
        callback(response);
        response.emit("data", JSON.stringify(result));
        response.emit("end");
      });
    };
    return request;
  };
}
test("Telegram sends JSON over HTTPS with no bot token in message content", async () => {
  let captured;
  const result = await call(
    token,
    "sendMessage",
    { chat_id: "42", text: "Connection restored" },
    transport({ ok: true, result: { message_id: 10 } }, (options, body) => {
      captured = { options, body };
    }),
  );
  assert.equal(result.message_id, 10);
  assert.equal(captured.options.hostname, "api.telegram.org");
  assert.equal(captured.options.method, "POST");
  assert.deepEqual(captured.body, {
    chat_id: "42",
    text: "Connection restored",
  });
});
test("Telegram rejects API errors without exposing token or raw server response", async () => {
  await assert.rejects(
    call(
      token,
      "sendMessage",
      {},
      transport({
        ok: false,
        error_code: 401,
        description: "sensitive " + token,
      }),
    ),
    (error) =>
      !error.message.includes(token) && /токен|Токен/.test(error.message),
  );
  await assert.rejects(
    call(token, "sendMessage", {}, transport({ ok: false, error_code: 429 })),
    /частоту/,
  );
});
test("transport failures do not leak request URLs", async () => {
  const request = () => {
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () =>
      setImmediate(() =>
        req.emit("error", Error("https://api.telegram.org/bot" + token)),
      );
    return req;
  };
  await assert.rejects(
    call(token, "sendMessage", {}, request),
    (error) =>
      !error.message.includes(token) && !error.message.includes("https:"),
  );
});
