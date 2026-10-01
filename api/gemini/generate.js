const UPSTREAM_URL = "https://parkview-plan-api.onrender.com/api/gemini/generate";
const UPSTREAM_ORIGIN = "https://jaden70749.github.io";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "POST 요청만 지원합니다" });
    return;
  }

  try {
    const upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: UPSTREAM_ORIGIN
      },
      body: JSON.stringify(request.body ?? {})
    });
    const body = await upstream.text();
    response.status(upstream.status);
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.send(body);
  } catch (_error) {
    response.status(502).json({ error: "AI 서버에 연결할 수 없습니다" });
  }
}
