const https = require("node:https");
function validateToken(token) {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token))
    throw Error("Проверьте токен бота из BotFather.");
  return token;
}
function call(token, method, data, request = https.request) {
  validateToken(token);
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    let settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      reject(Error(message));
    };
    const req = request(
      {
        hostname: "api.telegram.org",
        path: `/bot${token}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let output = "";
        response.on("data", (chunk) => {
          output += chunk;
          if (output.length > 1024 * 1024)
            fail("Слишком большой ответ Telegram.");
        });
        response.on("end", () => {
          if (settled) return;
          let result;
          try {
            result = JSON.parse(output);
          } catch {
            return fail("Telegram вернул некорректный ответ.");
          }
          if (!result.ok)
            return fail(
              result.error_code === 401
                ? "Токен Telegram не принят."
                : result.error_code === 409
                  ? "У бота включён webhook или другой получатель. Используйте отдельного бота."
                  : result.error_code === 429
                    ? "Telegram ограничил частоту запросов. Повторим позже."
                    : "Telegram не принял запрос. Проверьте chat ID и нажмите Старт в чате с ботом.",
            );
          settled = true;
          clearTimeout(timer);
          resolve(result.result);
        });
        response.on("error", () => fail("Соединение с Telegram прервано."));
      },
    );
    const timer = setTimeout(
      () => fail("Telegram не ответил за 12 секунд."),
      12000,
    );
    req.once("error", () => fail("Нет соединения с Telegram."));
    req.end(body);
  });
}
async function chats(token) {
  const updates = await call(token, "getUpdates", { timeout: 0, limit: 100 });
  const found = new Map();
  for (const update of updates) {
    const chat = (update.message || update.channel_post)?.chat;
    if (chat)
      found.set(String(chat.id), {
        id: String(chat.id),
        name:
          chat.title ||
          [chat.first_name, chat.last_name].filter(Boolean).join(" ") ||
          chat.username ||
          String(chat.id),
      });
  }
  return [...found.values()];
}
const send = (token, chatId, text) =>
  call(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
module.exports = { call, validateToken, chats, send };
