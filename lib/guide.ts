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
  goal: string; // 비어 있으면 목표 없이 시작한 것. 화면을 보고 단계별로 안내한다
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

  const pressed = req.history.length > 0 ? req.history.join(" → ") : "없음";

  if (isBrowsing(req)) {
    const browse = [
      system,
      "지금 사용자는 무엇을 주문할지 정하지 않고 시작했다. 화면을 보고 지금 단계에서 할 일을 안내한다.",
      "처음 화면의 '주문하기', 매장/포장 선택처럼 다음 단계로 넘어가는 버튼이 분명하면 그 버튼 하나를 골라 box를 채운다.",
      "메뉴처럼 사용자가 직접 골라야 하는 화면이면 눈에 띄는 선택지를 위치와 함께 두세 개 읽어 주고, 원하는 것을 말해 주면 안내하겠다고 덧붙인다. 이때 button은 빈 문자열, box는 빈 배열로 한다.",
    ].join("\n");
    return [
      { role: "system", content: browse },
      {
        role: "user",
        content: `목표: 아직 없음\n지금까지 누른 버튼: ${pressed}\n이 화면에서 무엇을 하면 되는지 알려 줘.`,
        images: [req.image],
      },
    ];
  }


  const user = `목표: ${req.goal}\n지금까지 누른 버튼: ${pressed}\n이 화면에서 다음에 누를 버튼을 알려 줘.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user, images: [req.image] },
  ];
}

/** 목표 없이 시작했으면 다음 단계 버튼을 안내하고, 골라야 하는 화면에서는 선택지를 읽어 준다. */
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
