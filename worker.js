const ORIGIN = "https://ceemx-star.github.io";
const TIERS = ["Sub-3", "Sub-5", "LTN", "MTN", "HTN", "Chadlite", "Chad", "Gigachad"];
const MODELS = ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.5-flash"];
const NORMS = [
  ["sym", "Симметрия, %", "96–100"],
  ["thirds", "Макс. отклонение третей лица от 33.3%, п.п.", "0–2"],
  ["lower", "Нижняя треть (подбородок к губам, 1:x)", "1.8–2.4"],
  ["canthal", "Кантальный наклон, градусы", "+4…+8"],
  ["fwhr", "fWHR (ширина скул к высоте до верхней губы)", "1.75–2.05"],
  ["jaw", "Челюсть к скулам", "0.78–0.86"],
  ["wh", "Ширина лица к высоте", "0.95–1.15"],
  ["mid", "Середина лица", "0.95–1.15"],
  ["eyes", "Межглазье", "0.9–1.1"],
  ["nose", "Ширина носа к межглазью", "0.9–1.15"],
  ["mouth", "Ширина рта к носу", "1.4–1.7"],
  ["lips", "Нижняя губа к верхней", "1.3–1.8"],
];
const hits = new Map();

function cors(extra) {
  return Object.assign({
    "access-control-allow-origin": ORIGIN,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "origin",
  }, extra || {});
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: cors({ "content-type": "application/json" }) });
}
const enc = new TextEncoder();
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const hex = (u) => Array.from(u).map((b) => b.toString(16).padStart(2, "0")).join("");

async function checkInitData(initData, botToken) {
  if (!initData || typeof initData !== "string") return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const dcs = Array.from(p.entries()).map(([k, v]) => k + "=" + v).sort().join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const calc = hex(await hmac(secret, dcs));
  if (calc !== hash) return null;
  const age = Date.now() / 1000 - Number(p.get("auth_date") || 0);
  if (!(age < 86400)) return null;
  try { return JSON.parse(p.get("user")).id; } catch (e) { return null; }
}

function num(v, lo, hi) {
  v = Number(v);
  return Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

async function evaluate(req, env) {
  if (!env.GEMINI_API_KEY) return json({ error: "no_key" }, 503);
  let b;
  try { b = await req.json(); } catch (e) { return json({ error: "bad_json" }, 400); }
  const uid = await checkInitData(b.initData, env.BOT_TOKEN);
  if (!uid) return json({ error: "unauthorized" }, 401);
  const now = Date.now(), h = (hits.get(uid) || []).filter((t) => now - t < 3600000);
  if (h.length >= 20) return json({ error: "rate_limited" }, 429);
  h.push(now); hits.set(uid, h);
  const raw = b.raw || {}, lines = [];
  for (const [id, name, norm] of NORMS) {
    const v = num(raw[id], -200, 1000);
    if (v === null) return json({ error: "bad_data" }, 400);
    lines.push(name + ": " + v.toFixed(2) + " (норма " + norm + ")");
  }
  const ms = num(b.meshSym, 0, 100), go = num(b.gridOverall, 0, 100);
  const gt = TIERS.includes(b.gridTier) ? b.gridTier : "неизвестно";
  const prompt =
    "Ты независимый эксперт по оценке пропорций лица по шкале looksmax-форумов (шкала не научная). " +
    "Другая программа уже поставила на фото сетку из 468 точек и посчитала замеры. Ты видишь только числа, лица не видишь.\n" +
    "Замеры:\n" + lines.join("\n") +
    (ms !== null ? "\nСимметрия по сетке из 468 точек: " + ms.toFixed(1) + "%" : "") +
    "\nПравила-сетка дали " + (go !== null ? go.toFixed(1) + " из 100" : "?") + ", тир " + gt + ".\n" +
    "Тиры от низшего к высшему: " + TIERS.join(", ") + ".\n" +
    "Оцени сам, какому тиру соответствует это сочетание замеров. Учитывай, что важнее одни замеры (кантальный наклон, челюсть, fWHR, симметрия, середина лица), а как они сочетаются между собой. Не подгоняй под тир сетки, если считаешь иначе, но если измерения выглядят нереалистично (возможна ошибка расстановки точек), скажи об этом. " +
    "Затем дай 3-4 коротких конкретных совета именно для этих замеров: уход за кожей, сон, питание в общих чертах, стрижка или борода, как переснять фото. Без экстремальных диет, калорий и цифр веса, без операций, лекарств и «костной ломки», без оскорблений; если нужна медицина, пиши «к врачу». " +
    'Верни только JSON: {"tier":"один из списка","why":"3-5 предложений по-русски: какие замеры решили оценку и почему","advice":["совет","совет"]}.';
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 1500, responseMimeType: "application/json" },
  });
  const list = (env.GEMINI_MODEL ? [env.GEMINI_MODEL] : []).concat(MODELS);
  let r = null;
  for (const m of list) {
    try {
      r = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent",
        { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" }, body }
      );
    } catch (e) { return json({ error: "upstream" }, 502); }
    if (r.status !== 404) break;
  }
  if (!r || !r.ok) return json({ error: "upstream_" + (r ? r.status : 0) }, 502);
  const d = await r.json();
  const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
  const text = parts.map((x) => x.text || "").join("");
  const a = text.indexOf("{"), z = text.lastIndexOf("}");
  let o;
  try { o = JSON.parse(text.slice(a, z + 1)); } catch (e) { return json({ error: "bad_answer" }, 502); }
  if (!o || !TIERS.includes(o.tier) || typeof o.why !== "string") return json({ error: "bad_answer" }, 502);
  const advice = Array.isArray(o.advice) ? o.advice.filter((x) => typeof x === "string").slice(0, 4).map((x) => x.slice(0, 300)) : [];
  return json({ tier: o.tier, why: o.why.slice(0, 1200), advice });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/evaluate") {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
      if (req.method === "POST") return evaluate(req, env);
      return json({ error: "method" }, 405);
    }
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
