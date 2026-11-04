import sharp from "sharp";
import {
  attachBoxes,
  buildLocateMessages,
  buildMessages,
  buildVerifyMessages,
  cropRegion,
  guideSchema,
  parseGuide,
  parseVerify,
  rejectGuide,
  verifySchema,
  type Guide,
  type GuideRequest,
  type Step,
} from "@/lib/guide";
import { AiError, chat } from "@/lib/ollama";

const MOCK = process.env.KIOSK_AI_MOCK === "1";
// 검증 단계는 아직 실험 중이라 기본은 꺼 둔다. 켜려면 KIOSK_VERIFY=1.
const VERIFY = process.env.KIOSK_VERIFY === "1";

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

  const guide = parseGuide(content, req.lang);
  if (!guide) {
    return Response.json({ error: "화면을 잘 읽지 못했어요. 다시 비춰 주세요." }, { status: 502 });
  }
  if (guide.steps.length === 0) return Response.json(guide);

  // 2단계: 고른 버튼들의 위치를 한 번에 찾는다. 실패해도 음성 안내는 할 수 있으니 상자 없이 돌려준다.
  try {
    const located = await chat(buildLocateMessages(req.image, guide.steps));
    // 3단계: 첫 버튼의 상자 안에 정말 그 버튼이 있는지 확인한다.
    return Response.json(await verify(attachBoxes(guide, located, req.width, req.height), req));
  } catch (e) {
    if (e instanceof AiError) return Response.json(guide);
    throw e;
  }
}

/**
 * 3단계(검증): 지금 누를 버튼(steps[0])의 상자 부분만 잘라서 그 버튼이 맞는지 다시 묻고, 아니라고 하면 안내를 거둔다.
 * 틀린 상자를 보여 주는 것이 안내를 잠깐 거르는 것보다 나쁘다. 검증 자체가 실패하면 안내는 그대로 돌려준다.
 * KIOSK_VERIFY=1일 때만 동작한다. 49문항 평가에서 틀린 안내는 줄지만(22→12개) 맞는 안내도 거른다(27→18개).
 * 예/아니오 질문은 비슷한 칸이 나란한 곳(결제 로고 등)에서 쉽게 "예"라고 답해 11개를 못 걸렀다. 글자를 읽어 비교하는 방식을 시험하던 중이다.
 */
async function verify(guide: Guide, req: GuideRequest): Promise<Guide> {
  const first = guide.steps[0];
  if (!VERIFY || !first?.box) return guide;
  try {
    const source = sharp(Buffer.from(req.image, "base64"));
    const { width, height } = await source.metadata();
    if (!width || !height) return guide;
    const crop = await source
      .extract(cropRegion(first.box, width, height))
      .resize({ width: 448 })
      .jpeg({ quality: 90 })
      .toBuffer();
    const answer = parseVerify(await chat(buildVerifyMessages(crop.toString("base64"), first.button), verifySchema));
    return answer === false ? rejectGuide(guide, req.lang) : guide;
  } catch {
    return guide;
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
    confidence: "high",
  };
}
