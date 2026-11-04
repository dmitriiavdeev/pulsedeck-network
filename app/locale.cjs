const translations = require("./ui/translations.json");
const errors = {
  "Введите IP-адрес или доменное имя без пробелов и протокола.":
    "Enter an IP address or hostname without spaces or a protocol.",
  "Укажите полный адрес сайта: https://example.com":
    "Enter a full website URL, such as https://example.com",
  "Нужен HTTP/HTTPS-адрес без логина и пароля.":
    "Use an HTTP/HTTPS URL without a username or password.",
  "Порт должен быть от 1 до 65535.": "Port must be between 1 and 65535.",
  "Chat ID должен быть числом. Для группы он может начинаться с минуса.":
    "Chat ID must be a number. Group IDs may start with a minus sign.",
  "В JSON нужен массив monitors.":
    "The JSON file must contain a monitors array.",
  "Сначала добавьте хотя бы один включённый адрес.":
    "Add at least one enabled monitor first.",
  "Файл больше 20 МБ. Разделите список на несколько файлов.":
    "File exceeds 20 MB. Split it into smaller files.",
  "Для Telegram нужны токен бота и chat ID.":
    "Telegram requires a bot token and chat ID.",
  "Windows не предоставила защиту для токена.":
    "Windows could not provide secure storage for the token.",
  "Укажите chat ID.": "Enter a chat ID.",
  "Неизвестный инструмент.": "Unknown tool.",
  "Сервер не ответил за 8 секунд.":
    "The server did not respond within 8 seconds.",
  "Сервер не предоставил сертификат.":
    "The server did not provide a certificate.",
  "Не удалось получить SSL-сертификат.":
    "Could not retrieve the SSL certificate.",
  "Проверьте токен бота из BotFather.": "Check your bot token from BotFather.",
  "Слишком большой ответ Telegram.": "Telegram response is too large.",
  "Telegram вернул некорректный ответ.":
    "Telegram returned an invalid response.",
  "Токен Telegram не принят.": "Telegram rejected the bot token.",
  "У бота включён webhook или другой получатель. Используйте отдельного бота.":
    "The bot has a webhook or another receiver. Use a dedicated bot.",
  "Telegram ограничил частоту запросов. Повторим позже.":
    "Telegram rate limit reached. Retrying later.",
  "Telegram не принял запрос. Проверьте chat ID и нажмите Старт в чате с ботом.":
    "Telegram rejected the request. Check the chat ID and press Start in your bot chat.",
  "Соединение с Telegram прервано.": "The Telegram connection was interrupted.",
  "Telegram не ответил за 12 секунд.":
    "Telegram did not respond within 12 seconds.",
  "Нет соединения с Telegram.": "Could not connect to Telegram.",
  "Не удалось прочитать настройки. Исходный файл сохранён. Проверьте pulsedeck.json в папке данных приложения.":
    "Could not read settings. The original file has been preserved. Check pulsedeck.json in the application data folder.",
  "В файле настроек повторяются идентификаторы серверов.":
    "The settings file contains duplicate monitor IDs.",
};
function t(language, key, values = {}) {
  return String(
    translations[language]?.[key] || translations.en[key] || key,
  ).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
}
function errorText(message, language) {
  if (language !== "en") return message;
  if (errors[message]) return errors[message];
  if (/^[a-z]+: допустимо от \d+ до \d+\.$/i.test(message))
    return message
      .replace("допустимо от", "must be between")
      .replace(" до ", " and ");
  return /[а-яё]/i.test(message)
    ? "The operation could not be completed. Check your input and try again."
    : message;
}
module.exports = { t, errorText };
