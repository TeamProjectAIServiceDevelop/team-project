import { buildMenuMessages, menuSchema, parseMenu, type Menu, type MenuRequest } from "@/lib/guide";
import { AiError, chat } from "@/lib/ollama";

const MOCK = process.env.KIOSK_AI_MOCK === "1";

/** 목표를 고르려고 찍은 메뉴 화면에서 고를 수 있는 메뉴를 읽는다. */
export async function POST(request: Request) {
  const req = readRequest(await request.json().catch(() => null));
  if (!req) return Response.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });

  if (MOCK) return Response.json(mockMenu());

  let content: string;
  try {
    content = await chat(buildMenuMessages(req), menuSchema);
  } catch (e) {
    if (e instanceof AiError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const menu = parseMenu(content);
  if (!menu) {
    return Response.json({ error: "메뉴를 잘 읽지 못했어요. 다시 찍어 주세요." }, { status: 502 });
  }
  return Response.json(menu);
}

function readRequest(body: unknown): MenuRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const ok =
    typeof b.image === "string" &&
    b.image.length > 0 &&
    b.image.length < 8_000_000 &&
    (b.lang === "ko" || b.lang === "en");
  return ok ? (b as MenuRequest) : null;
}

/** AI 서버 없이 화면 흐름을 확인할 때 쓰는 가짜 메뉴. */
function mockMenu(): Menu {
  return {
    items: [
      { name: "아이스 아메리카노", price: "2,000원" },
      { name: "카페라떼", price: "2,900원" },
      { name: "바닐라라떼", price: "3,300원" },
      { name: "딸기 스무디", price: "3,800원" },
    ],
    message: "아메리카노, 카페라떼, 바닐라라떼, 딸기 스무디가 있어요. 주문할 메뉴를 하나 골라 주세요.",
  };
}
