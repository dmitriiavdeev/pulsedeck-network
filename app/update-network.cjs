const https = require("node:https");
const REPOSITORY = "dmitriiavdeev/pulsedeck-network";
function trusted(url) {
  const u = new URL(url);
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    (!u.port || u.port === "443") &&
    (["api.github.com", "github.com"].includes(u.hostname) ||
      u.hostname.endsWith(".githubusercontent.com"))
  );
}
function request(
  url,
  { range, maxBytes = 2 * 1024 * 1024 } = {},
  redirects = 0,
) {
  return new Promise((resolve, reject) => {
    if (!trusted(url) || redirects > 5) return reject(Error("updateInvalid"));
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.destroy();
      error ? reject(error) : resolve(value);
    };
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "PulseDeck-Updater",
          Accept:
            new URL(url).hostname === "api.github.com"
              ? "application/json"
              : "application/octet-stream",
          "Accept-Encoding": "identity",
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        },
      },
      (response) => {
        if (
          [301, 302, 303, 307, 308].includes(response.statusCode) &&
          response.headers.location
        ) {
          let next;
          try {
            next = new URL(response.headers.location, url).href;
          } catch {
            return finish(Error("updateInvalid"));
          }
          response.destroy();
          clearTimeout(timer);
          done = true;
          req.destroy();
          request(next, { range, maxBytes }, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (response.statusCode === 403 || response.statusCode === 429)
          return finish(Error("updateRateLimit"));
        if (range) {
          if (
            response.statusCode !== 206 ||
            response.headers["content-range"] !==
              `bytes ${range.start}-${range.end}/${range.total}`
          )
            return finish(Error("updateRangeUnsupported"));
        } else if (response.statusCode !== 200)
          return finish(Error("updateNetwork"));
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) return finish(Error("updateInvalid"));
          chunks.push(chunk);
        });
        response.on("end", () => finish(null, Buffer.concat(chunks)));
        response.on("error", () => finish(Error("updateNetwork")));
      },
    );
    const timer = setTimeout(() => finish(Error("updateNetwork")), 30000);
    req.on("error", () => finish(Error("updateNetwork")));
  });
}
module.exports = { REPOSITORY, request };
