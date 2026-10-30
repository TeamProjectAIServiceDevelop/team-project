export type Lang = "ko" | "en";

/** 버튼 위치. 사진 너비·높이에 대한 비율(0~1)이라 화면 크기와 상관없이 그대로 겹쳐 그릴 수 있다. */
export type Box = { left: number; top: number; width: number; height: number };

export type Guide = {
  stage: string;
  button: string;
  where: string;
  box: Box | null;
  message: string;
  done: boolean;
};

export type GuideRequest = {
  image: string; // base64 JPEG (data URL 접두사 제외)
  width: number;
  height: number;
  goal: string; // 사용자가 정한 주문 목표. 비어 있으면 안 된다
  history: string[];
  lang: Lang;
};

/** Ollama `format`에 넘기는 출력 스키마. box가 비어 있으면 버튼을 못 찾은 것이다. */
export const guideSchema = {
  type: "object",
  properties: {
    stage: { type: "string" },
    button: { type: "string" },
    where: { type: "string" },
    box: { type: "array", items: { type: "number" } },
    message: { type: "string" },
    done: { type: "boolean" },
  },
  required: ["stage", "button", "where", "box", "message", "done"],
} as const;

export function buildMessages(req: GuideRequest) {
  const answerLang = req.lang === "ko" ? "한국어" : "English";
  const system = [
    "너는 키오스크 앞에서 주문을 어려워하는 사람(고령자, 저시력자, 외국인)을 돕는 안내원이다.",
    "사용자가 휴대폰 카메라로 비추는 키오스크 화면을 보고, 사용자의 목표를 이루기 위해 지금 눌러야 할 버튼 딱 하나를 고른다.",
    `사진 크기는 가로 ${req.width}픽셀, 세로 ${req.height}픽셀이다.`,
    "box에는 그 버튼의 사진 속 픽셀 좌표 [x1, y1, x2, y2](왼쪽 위, 오른쪽 아래)를 넣는다.",
    "버튼이 보이지 않거나 화면이 흐리면 box를 빈 배열로 두고, message로 화면을 다시 잘 비춰 달라고 부탁한다.",
    "목표한 주문이 끝난 화면(주문 완료, 영수증 출력 등)이면 done을 true로 한다.",
    "stage는 현재 화면 단계(예: 처음 화면, 메뉴 선택, 옵션 선택, 장바구니, 결제)이다.",
    "where는 버튼 위치를 방향으로 설명한다(예: 화면 오른쪽 아래).",
    "message는 소리 내어 읽어 줄 안내문이다. 짧고 쉬운 한두 문장으로, 위치와 버튼 이름을 함께 말한다.",
    "결제 단계라면 금액을 확인하라고 덧붙인다.",
    `stage, button, where, message는 ${answerLang}로 쓴다. button은 화면에 적힌 글자 그대로 쓴다.`,
  ].join("\n");

  const pressed = req.history.length > 0 ? req.history.join(" → ") : "없음";
  const user = `목표: ${req.goal}\n지금까지 누른 버튼: ${pressed}\n이 화면에서 다음에 누를 버튼을 알려 줘.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user, images: [req.image] },
  ];
}

/** 모델 출력(JSON 문자열)을 검증하고 좌표를 비율로 바꾼다. 형식이 틀리면 null. */
export function parseGuide(raw: string, width: number, height: number): Guide | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.message !== "string" || d.message.trim() === "") return null;

  return {
    stage: typeof d.stage === "string" ? d.stage : "",
    button: typeof d.button === "string" ? d.button : "",
    where: typeof d.where === "string" ? d.where : "",
    box: toBox(d.box, width, height),
    message: d.message.trim(),
    done: d.done === true,
  };
}

function toBox(value: unknown, width: number, height: number): Box | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);
  const [a, b, c, d] = value as number[];
  const x1 = clamp(Math.min(a, c), width);
  const x2 = clamp(Math.max(a, c), width);
  const y1 = clamp(Math.min(b, d), height);
  const y2 = clamp(Math.max(b, d), height);
  if (x2 - x1 < 2 || y2 - y1 < 2) return null;
  return {
    left: x1 / width,
    top: y1 / height,
    width: (x2 - x1) / width,
    height: (y2 - y1) / height,
  };
}

/** 목표를 고르려고 찍은 메뉴 화면에서 읽은 메뉴 하나. price는 화면에 없으면 빈 문자열이다. */
export type MenuItem = { name: string; price: string };

export type Menu = { items: MenuItem[]; message: string };

export type MenuRequest = {
  image: string; // base64 JPEG (data URL 접두사 제외)
  lang: Lang;
};

const MAX_MENU_ITEMS = 12;

/** Ollama `format`에 넘기는 메뉴 읽기 출력 스키마. items가 비어 있으면 메뉴를 못 찾은 것이다. */
export const menuSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, price: { type: "string" } },
        required: ["name", "price"],
      },
    },
    message: { type: "string" },
  },
  required: ["items", "message"],
} as const;

export function buildMenuMessages(req: MenuRequest) {
  const answerLang = req.lang === "ko" ? "한국어" : "English";
  const system = [
    "너는 키오스크 앞에서 주문을 어려워하는 사람(고령자, 저시력자, 외국인)을 돕는 안내원이다.",
    "사용자가 주문할 메뉴를 고르려고 찍은 키오스크 화면 사진을 보고, 고를 수 있는 메뉴를 읽는다.",
    `items에는 화면에 보이는 메뉴를 최대 ${MAX_MENU_ITEMS}개 넣는다. 탭, 결제, 장바구니, 처음으로 같은 버튼은 넣지 않는다.`,
    "name은 화면에 적힌 메뉴 이름 그대로 쓰고, price는 화면에 보이는 가격을 그대로 쓴다. 가격이 없으면 빈 문자열로 둔다.",
    "메뉴가 보이지 않거나 사진이 흐리면 items를 빈 배열로 두고, message로 메뉴 화면을 다시 찍어 달라고 부탁한다.",
    `message는 소리 내어 읽어 줄 짧은 안내문으로, 어떤 메뉴가 있는지 한두 문장으로 알려 주고 하나를 골라 달라고 말한다. message는 ${answerLang}로 쓴다.`,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: "이 화면에서 고를 수 있는 메뉴를 알려 줘.", images: [req.image] },
  ];
}

/** 메뉴 읽기 출력(JSON 문자열)을 검증한다. 형식이 틀리면 null. */
export function parseMenu(raw: string): Menu | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.message !== "string" || d.message.trim() === "") return null;
  if (!Array.isArray(d.items)) return null;

  const items: MenuItem[] = [];
  for (const item of d.items) {
    if (typeof item !== "object" || item === null) continue;
    const { name, price } = item as Record<string, unknown>;
    if (typeof name !== "string" || name.trim() === "") continue;
    items.push({ name: name.trim(), price: typeof price === "string" ? price.trim() : "" });
  }
  return { items: items.slice(0, MAX_MENU_ITEMS), message: d.message.trim() };
}
