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
  goal: string; // 비어 있으면 목표 없이 메뉴를 둘러보는 중
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
    "사용자가 찍은 키오스크 화면 사진을 보고, 사용자의 목표를 이루기 위해 지금 눌러야 할 버튼 딱 하나를 고른다.",
    `사진 크기는 가로 ${req.width}픽셀, 세로 ${req.height}픽셀이다.`,
    "box에는 그 버튼의 사진 속 픽셀 좌표 [x1, y1, x2, y2](왼쪽 위, 오른쪽 아래)를 넣는다.",
    "버튼이 보이지 않거나 사진이 흐리면 box를 빈 배열로 두고, message로 다시 찍어 달라고 부탁한다.",
    "목표한 주문이 끝난 화면(주문 완료, 영수증 출력 등)이면 done을 true로 한다.",
    "stage는 현재 화면 단계(예: 처음 화면, 메뉴 선택, 옵션 선택, 장바구니, 결제)이다.",
    "where는 버튼 위치를 방향으로 설명한다(예: 화면 오른쪽 아래).",
    "message는 소리 내어 읽어 줄 안내문이다. 짧고 쉬운 한두 문장으로, 위치와 버튼 이름을 함께 말한다.",
    "결제 단계라면 금액을 확인하라고 덧붙인다.",
    `stage, button, where, message는 ${answerLang}로 쓴다. button은 화면에 적힌 글자 그대로 쓴다.`,
  ].join("\n");

  if (isBrowsing(req)) {
    const browse = [
      system,
      "지금 사용자는 주문할 메뉴를 정하지 않고 화면을 둘러보는 중이다. 누를 버튼을 고르지 않는다.",
      "message에는 지금 화면이 어떤 단계인지와 눈에 띄는 메뉴·버튼을 위치와 함께 두세 문장으로 읽어 준다.",
      "이때 button은 빈 문자열, box는 빈 배열, done은 false로 한다.",
    ].join("\n");
    return [
      { role: "system", content: browse },
      { role: "user", content: "목표: 없음(둘러보기)\n이 화면에 무엇이 있는지 알려 줘.", images: [req.image] },
    ];
  }

  const pressed = req.history.length > 0 ? req.history.join(" → ") : "없음";
  const user = `목표: ${req.goal}\n지금까지 누른 버튼: ${pressed}\n이 화면에서 다음에 누를 버튼을 알려 줘.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user, images: [req.image] },
  ];
}

/** 목표 없이 시작했으면 버튼을 고르지 않고 화면을 읽어 주기만 한다. */
export function isBrowsing(req: Pick<GuideRequest, "goal">) {
  return req.goal.trim() === "";
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
