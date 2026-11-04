import {
  attachBoxes,
  buildLocateMessages,
  buildMessages,
  guideSchema,
  parseGuide,
  type Guide,
  type GuideRequest,
  type Step,
} from "@/lib/guide";
import { AiError, chat } from "@/lib/ollama";

const MOCK = process.env.KIOSK_AI_MOCK === "1";

export async function POST(request: Request) {
  const req = readRequest(await request.json().catch(() => null));
  if (!req) return Response.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });

  if (MOCK) return Response.json(mockGuide(req));

  // 1단계: 이 화면에서 누를 버튼과 순서를 정한다.
  let content: string;
  try {
    content = await chat(buildMessages(req), guideSchema);
  } catch (e) {
    if (e instanceof AiError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const guide = parseGuide(content);
  if (!guide) {
    return Response.json({ error: "화면을 잘 읽지 못했어요. 다시 비춰 주세요." }, { status: 502 });
  }
  if (guide.steps.length === 0) return Response.json(guide);

  // 2단계: 고른 버튼들의 위치를 한 번에 찾는다. 실패해도 음성 안내는 할 수 있으니 상자 없이 돌려준다.
  try {
    const located = await chat(buildLocateMessages(req.image, guide.steps));
    return Response.json(attachBoxes(guide, located, req.width, req.height));
  } catch (e) {
    if (e instanceof AiError) return Response.json(guide);
    throw e;
  }
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
  const plan: Step[] = [
    { button: "커피(ICE)", kind: "button", box: { left: 0.35, top: 0.1, width: 0.15, height: 0.05 } },
    { button: "(ICE)아메리카노", kind: "menu", box: { left: 0.24, top: 0.22, width: 0.17, height: 0.24 } },
    { button: "결제하기", kind: "button", box: { left: 0.7, top: 0.82, width: 0.25, height: 0.12 } },
  ];
  const steps = done ? [] : plan.slice(step);
  const button = steps[0]?.button ?? "";
  return {
    stage: ["메뉴 선택", "메뉴 선택", "장바구니"][Math.min(step, 2)],
    button,
    where: "화면 가운데",
    box: steps[0]?.box ?? null,
    steps,
    message: done ? "주문이 끝났어요. 영수증을 챙기세요." : `1번 '${button}' 버튼을 누르세요.`,
    done,
  };
}
