import { buildMessages, guideSchema, isBrowsing, parseGuide, type Guide, type GuideRequest } from "@/lib/guide";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5vl:7b";
const MOCK = process.env.KIOSK_AI_MOCK === "1";

export async function POST(request: Request) {
  const req = readRequest(await request.json().catch(() => null));
  if (!req) return Response.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });

  if (MOCK) return Response.json(mockGuide(req));

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: guideSchema,
        options: { temperature: 0 },
        messages: buildMessages(req),
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    return Response.json({ error: "AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
  if (!res.ok) {
    return Response.json({ error: `AI 서버 오류 (${res.status})` }, { status: 502 });
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const guide = parseGuide(data.message?.content ?? "", req.width, req.height);
  if (!guide) {
    return Response.json({ error: "화면을 잘 읽지 못했어요. 다시 찍어 주세요." }, { status: 502 });
  }
  return Response.json(guide);
}

function readRequest(body: unknown): GuideRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const ok =
    typeof b.image === "string" &&
    b.image.length > 0 &&
    b.image.length < 8_000_000 &&
    typeof b.width === "number" &&
    b.width > 0 &&
    typeof b.height === "number" &&
    b.height > 0 &&
    typeof b.goal === "string" &&
    b.goal.length <= 200 &&
    Array.isArray(b.history) &&
    b.history.length <= 30 &&
    b.history.every((h) => typeof h === "string") &&
    (b.lang === "ko" || b.lang === "en");
  return ok ? (b as GuideRequest) : null;
}

/** AI 서버 없이 화면 흐름을 확인할 때 쓰는 가짜 응답. 세 번째 단계에서 끝난다. */
function mockGuide(req: GuideRequest): Guide {
  if (isBrowsing(req)) {
    return {
      stage: "메뉴 선택",
      button: "",
      where: "",
      box: null,
      message: "메뉴를 고르는 화면이에요. 위쪽에 커피, 음료, 디저트 탭이 있고, 오른쪽 아래에 결제하기 버튼이 있어요.",
      done: false,
    };
  }
  const step = req.history.length;
  const done = step >= 2;
  const button = ["커피", "아이스 아메리카노", "결제하기"][Math.min(step, 2)];
  return {
    stage: ["메뉴 선택", "메뉴 선택", "장바구니"][Math.min(step, 2)],
    button,
    where: "화면 가운데",
    box: done ? null : { left: 0.35 + step * 0.1, top: 0.4, width: 0.25, height: 0.15 },
    message: done ? "주문이 끝났어요. 영수증을 챙기세요." : `화면 가운데 '${button}' 버튼을 누르세요.`,
    done,
  };
}
