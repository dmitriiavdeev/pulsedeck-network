import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const https = require("node:https");
const { request } = require("../app/update-network.cjs");
test("partial downloads require the exact range and never fall back to a full file", async () => {
  const original = https.get;
  let status = 206,
    contentRange = "bytes 10-13/100";
  https.get = (_, options, callback) => {
    assert.equal(options.headers.Range, "bytes=10-13");
    const req = new EventEmitter();
    req.destroy = () => {};
    setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = status;
      res.headers = { "content-range": contentRange };
      let destroyed = false;
      res.destroy = () => {
        destroyed = true;
      };
      callback(res);
      if (!destroyed) {
        res.emit("data", Buffer.from("part"));
        res.emit("end");
      }
    });
    return req;
  };
  const options = { range: { start: 10, end: 13, total: 100 }, maxBytes: 4 };
  try {
    assert.equal(
      (await request("https://github.com/file", options)).toString(),
      "part",
    );
    status = 200;
    await assert.rejects(
      request("https://github.com/file", options),
      /updateRangeUnsupported/,
    );
    status = 206;
    contentRange = "bytes 0-3/100";
    await assert.rejects(
      request("https://github.com/file", options),
      /updateRangeUnsupported/,
    );
    await assert.rejects(
      request("http://github.com/file", options),
      /updateInvalid/,
    );
    await assert.rejects(
      request("https://github.com.evil.example/file", options),
      /updateInvalid/,
    );
  } finally {
    https.get = original;
  }
});
