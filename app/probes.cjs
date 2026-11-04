const net = require("node:net");
const tls = require("node:tls");
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns").promises;
const { execFile } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { host } = require("./core.cjs");

function tcp(address, port, timeout) {
  return new Promise((resolve) => {
    const start = performance.now();
    let socket, timer;
    const done = (ok, detail) => {
      clearTimeout(timer);
      if (socket) socket.destroy();
      resolve({
        ok,
        latency: ok ? Math.round(performance.now() - start) : null,
        detail,
      });
    };
    timer = setTimeout(() => done(false, "Тайм-аут соединения"), timeout);
    socket = net.connect({ host: address, port });
    socket.once("connect", () => done(true, `Порт ${port} открыт`));
    socket.once("error", () => done(false, `Нет соединения с портом ${port}`));
  });
}
function ssh(address, port, timeout) {
  return new Promise((resolve) => {
    const start = performance.now();
    let socket,
      timer,
      finished = false,
      connected = false;
    let pending = Buffer.alloc(0),
      received = 0,
      lines = 0;
    const done = (ok, detail) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve({
        ok,
        latency: ok ? Math.round(performance.now() - start) : null,
        detail,
      });
    };
    timer = setTimeout(
      () => done(false, connected ? "sshNoGreeting" : "sshConnectTimeout"),
      timeout,
    );
    try {
      socket = net.connect({ host: address, port });
      socket.once("connect", () => {
        connected = true;
        socket.write("SSH-2.0-PulseDeck\r\n");
      });
      socket.on("data", (chunk) => {
        if (finished) return;
        // Bound the identification exchange without retaining arbitrary remote data.
        received += chunk.length;
        pending = Buffer.concat([pending, chunk.subarray(0, 8192)]);
        let end;
        while ((end = pending.indexOf(10)) >= 0) {
          const bytes = pending.subarray(0, end + 1);
          pending = pending.subarray(end + 1);
          const line = bytes.toString("latin1").replace(/\r?\n$/, "");
          if (line.startsWith("SSH-")) {
            const valid =
              bytes.length <= 255 &&
              /^SSH-(?:2\.0|1\.99)-[!-~]+(?: [\x20-\x7E]*)?$/.test(line);
            return done(valid, valid ? "sshGreeting" : "sshInvalidGreeting");
          }
          if (
            ++lines > 50 ||
            bytes.length > 1024 ||
            /[\x00-\x08\x0B-\x1F]/.test(line)
          )
            return done(false, "sshInvalidGreeting");
        }
        if (received > 8192 || pending.length > 1024)
          done(false, "sshInvalidGreeting");
      });
      socket.once("error", () => done(false, "sshConnectionFailed"));
      socket.once("end", () => done(false, "sshClosed"));
      socket.once("close", () => done(false, "sshClosed"));
    } catch {
      done(false, "sshConnectionFailed");
    }
  });
}
function web(address, timeout) {
  const start = performance.now();
  const deadline = Date.now() + timeout;
  function request(url, redirects) {
    return new Promise((resolve) => {
      let req,
        timer,
        finished = false;
      const done = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        req?.destroy();
        resolve(result);
      };
      const left = deadline - Date.now();
      if (left <= 0)
        return resolve({ ok: false, latency: null, detail: "Тайм-аут HTTP" });
      timer = setTimeout(
        () => done({ ok: false, latency: null, detail: "Тайм-аут HTTP" }),
        left,
      );
      req = (url.startsWith("https:") ? https : http).get(
        url,
        { headers: { "User-Agent": "PulseDeck/1.0", Accept: "*/*" } },
        (response) => {
          const code = response.statusCode;
          const location = response.headers.location;
          if (
            [301, 302, 303, 307, 308].includes(code) &&
            location &&
            redirects >= 5
          )
            return done({
              ok: false,
              latency: null,
              detail: "Too many redirects",
            });
          if (
            [301, 302, 303, 307, 308].includes(code) &&
            location &&
            redirects < 5
          ) {
            let next;
            try {
              next = new URL(location, url);
            } catch {
              return done({
                ok: false,
                latency: null,
                detail: "Некорректный редирект",
              });
            }
            if (
              !["http:", "https:"].includes(next.protocol) ||
              next.username ||
              next.password
            )
              return done({
                ok: false,
                latency: null,
                detail: "Неподдерживаемый редирект",
              });
            clearTimeout(timer);
            finished = true;
            response.destroy();
            req.destroy();
            request(next.href, redirects + 1).then(resolve);
            return;
          }
          response.destroy();
          done({
            ok: code >= 200 && code < 400,
            latency: Math.round(performance.now() - start),
            detail: `HTTP ${code}`,
          });
        },
      );
      req.once("error", (e) =>
        done({
          ok: false,
          latency: null,
          detail: [
            "CERT_HAS_EXPIRED",
            "DEPTH_ZERO_SELF_SIGNED_CERT",
            "ERR_TLS_CERT_ALTNAME_INVALID",
          ].includes(e.code)
            ? "Ошибка SSL-сертификата"
            : "HTTP-соединение недоступно",
        }),
      );
    });
  }
  return request(address, 0);
}
function ping(address, timeout, executable) {
  return new Promise((resolve) =>
    execFile(
      executable,
      [address, String(timeout)],
      {
        windowsHide: true,
        timeout: timeout + 2000,
        maxBuffer: 16384,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error)
          return resolve({
            ok: false,
            latency: null,
            detail: "Нет ответа ICMP",
          });
        try {
          const result = JSON.parse(stdout.replace(/^\uFEFF/, "").trim());
          resolve({
            ...result,
            detail: result.ok
              ? "Ответ ICMP"
              : result.detail === "TimedOut"
                ? "Нет ответа ICMP"
                : result.detail,
          });
        } catch {
          resolve({
            ok: false,
            latency: null,
            detail: "Не удалось выполнить ping",
          });
        }
      },
    ),
  );
}
async function probe(monitor, timeout, executable) {
  try {
    return await (monitor.type === "ssh"
      ? ssh(monitor.address, monitor.port, timeout)
      : monitor.type === "tcp"
        ? tcp(monitor.address, monitor.port, timeout)
        : monitor.type === "http"
          ? web(monitor.address, timeout)
          : ping(monitor.address, timeout, executable));
  } catch {
    return {
      ok: false,
      latency: null,
      detail: "Не удалось выполнить проверку",
    };
  }
}
async function lookup(address) {
  address = host(address);
  const resolver = new dns.Resolver({ timeout: 3000, tries: 1 });
  const timer = setTimeout(() => resolver.cancel(), 8000);
  try {
    const kinds = ["A", "AAAA", "MX", "NS", "TXT"];
    const results = await Promise.all(
      kinds.map(async (type) => {
        try {
          return { type, records: await resolver.resolve(address, type) };
        } catch {
          return { type, records: [] };
        }
      }),
    );
    return results;
  } finally {
    clearTimeout(timer);
  }
}
function certificate(address, port = 443) {
  address = host(address);
  return new Promise((resolve, reject) => {
    let socket;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Error("Сервер не ответил за 8 секунд."));
    }, 8000);
    socket = tls.connect(
      {
        host: address,
        port,
        servername: net.isIP(address) ? undefined : address,
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate();
        const trusted = socket.authorized;
        const identityError = tls.checkServerIdentity(address, cert);
        clearTimeout(timer);
        socket.end();
        socket.destroy();
        if (!cert.valid_to)
          return reject(Error("Сервер не предоставил сертификат."));
        resolve({
          subject: cert.subject?.CN || address,
          issuer: cert.issuer?.O || cert.issuer?.CN || "",
          from: cert.valid_from,
          to: cert.valid_to,
          days: Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86400000),
          trusted: trusted && !identityError,
          fingerprint: cert.fingerprint256,
        });
      },
    );
    socket.once("error", () => {
      clearTimeout(timer);
      reject(Error("Не удалось получить SSL-сертификат."));
    });
  });
}
module.exports = { probe, tcp, ssh, web, ping, lookup, certificate };
