export default {
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("ok");
    let u;
    try { u = await req.json(); } catch (e) { return new Response("ok"); }
    const m = u.message;
    if (m && m.chat) {
      await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: m.chat.id,
          text: "Фейсметр: загрузите фото анфас, нейросеть поставит 468 точек и посчитает пропорции лица. Фото остаётся на вашем телефоне.",
          reply_markup: { inline_keyboard: [[{ text: "Открыть Фейсметр", web_app: { url: env.WEBAPP_URL } }]] },
        }),
      });
    }
    return new Response("ok");
  },
};
