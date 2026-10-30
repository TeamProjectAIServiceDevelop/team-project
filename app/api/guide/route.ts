import { buildMessages, guideSchema, parseGuide, type Guide, type GuideRequest } from "@/lib/guide";
import { AiError, chat } from "@/lib/ollama";

const MOCK = process.env.KIOSK_AI_MOCK === "1";

export async function POST(request: Request) {
  const req = readRequest(await request.json().catch(() => null));
  if (!req) return Response.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });

  if (MOCK) return Response.json(mockGuide(req));

  let content: string;
  try {
    content = await chat(buildMessages(req), guideSchema);
  } catch (e) {
    if (e instanceof AiError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const guide = parseGuide(content, req.width, req.height);
  if (!guide) {
    return Response.json({ error: "화면을 잘 읽지 못했어요. 다시 비춰 주세요." }, { status: 502 });
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
    b.goal.trim().length > 0 &&
    b.goal.length <= 200 &&
    Array.isArray(b.history) &&
    b.history.length <= 30 &&
    b.history.every((h) => typeof h === "string") &&
    (b.lang === "ko" || b.lang === "en");
  return ok ? (b as GuideRequest) : null;
}

/** AI 서버 없이 화면 흐름을 확인할 때 쓰는 가짜 응답. 세 번째 단계에서 끝난다. */
function mockGuide(req: GuideRequest): Guide {
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
