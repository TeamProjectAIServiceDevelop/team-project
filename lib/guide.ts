export type Lang = "ko" | "en";

/** 버튼 위치. 사진 너비·높이에 대한 비율(0~1)이라 화면 크기와 상관없이 그대로 겹쳐 그릴 수 있다. */
export type Box = { left: number; top: number; width: number; height: number };

/** 모델이 이 안내를 얼마나 확신하는지. low면 웹은 상자를 띄우지 않고 다음 장면을 다시 분석한다. */
export type Confidence = "high" | "medium" | "low";

/** 이 화면에서 누를 버튼 하나. kind는 위치를 찾을 때 메뉴 칸 전체를 감쌀지 정한다. box가 null이면 위치를 못 찾은 것이다. */
export type Step = { button: string; kind: "menu" | "button"; box: Box | null };

export type Guide = {
  stage: string;
  /** 지금 누를 버튼(steps[0])의 이름과 위치. 기록·피드백은 이것을 쓴다. */
  button: string;
  where: string;
  box: Box | null;
  /** 이 화면에서 누를 순서대로 고른 버튼(최대 MAX_STEPS개). 사진 위에 1, 2, 3으로 표시한다. */
  steps: Step[];
  message: string;
  done: boolean;
  confidence: Confidence;
};

export const MAX_STEPS = 3;

export type GuideRequest = {
  image: string; // base64 JPEG (data URL 접두사 제외)
  width: number;
  height: number;
  goal: string; // 사용자가 정한 주문 목표. 비어 있으면 안 된다
  history: string[];
  lang: Lang;
};

/**
 * 1단계(판단) Ollama `format` 스키마. 누를 버튼의 이름과 순서만 정하고 좌표는 받지 않는다.
 * 좌표를 이 JSON 안에 같이 받으면 모델이 상자를 작게·엉뚱하게 그려서, 위치는 2단계에서 따로 찾는다.
 * steps가 비어 있으면 버튼을 못 찾은 것이다.
 */
export const guideSchema = {
  type: "object",
  properties: {
    stage: { type: "string" },
    where: { type: "string" },
    steps: {
      type: "array",
      maxItems: MAX_STEPS,
      items: {
        type: "object",
        properties: {
          button: { type: "string", maxLength: 40 },
          kind: { type: "string", enum: ["menu", "button"] },
        },
        required: ["button", "kind"],
      },
    },
    message: { type: "string", maxLength: 150 },
    done: { type: "boolean" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["stage", "where", "steps", "message", "done", "confidence"],
} as const;

export function buildMessages(req: GuideRequest) {
  const answerLang = req.lang === "ko" ? "한국어" : "English";
  const system = [
    "너는 키오스크 앞에서 주문을 어려워하는 사람(고령자, 저시력자, 외국인)을 돕는 안내원이다.",
    "사용자가 휴대폰 카메라로 비추는 키오스크 화면을 보고, 사용자의 목표를 이루기 위해 이 화면에서 눌러야 할 버튼을 누를 순서대로 고른다.",
    `steps에는 이 사진에 실제로 보이는 버튼을 누를 순서대로 최대 ${MAX_STEPS}개 넣는다. 첫 번째가 지금 바로 누를 버튼이다.`,
    "첫 버튼을 누른 뒤 이 화면에서 이어서 누를 버튼(예: 결제하기, 주문하기, 담기)이 보이면 빠뜨리지 말고 2번, 3번으로 넣는다. 원하는 메뉴가 다른 탭에 있으면 그 탭을 1번으로 넣는다.",
    '형식 예(이름은 설명용이다. 실제로는 사진 속 글자를 그대로 쓴다): 차가운 음료 탭이 열린 화면에서 목표가 따뜻한 라떼 → "steps": [{"button": "<따뜻한 음료 탭 글자>", "kind": "button"}, {"button": "<라떼 메뉴 이름>", "kind": "menu"}, {"button": "<결제·주문 버튼 글자>", "kind": "button"}]',
    "button은 이 사진에서 글자를 직접 읽을 수 있는 버튼만 쓴다. 목표에 포장·매장·결제 수단이 들어 있어도, 그 버튼이 이 사진에 없으면(대개 다음 화면에 나온다) 절대 넣지 않는다.",
    "kind는 사진·이름·가격이 있는 메뉴 칸이면 menu, 탭이나 글자 버튼이면 button이다.",
    "누를 버튼이 보이지 않거나 화면이 흐리면 steps를 빈 배열로 두고, message로 화면을 다시 잘 비춰 달라고 부탁한다.",
    "목표한 주문이 끝난 화면(주문 완료, 영수증 출력 등)이면 done을 true로 한다.",
    "stage는 현재 화면 단계(예: 처음 화면, 메뉴 선택, 옵션 선택, 장바구니, 결제)이다.",
    "where는 첫 번째 버튼 위치를 방향으로 설명한다(예: 화면 오른쪽 아래).",
    // 순서는 화면에 1→2→3으로 따로 보여 준다. message에 번호를 세게 하면 모델이 '4번… 9번…'을 끝없이 이어 썼다.
    "message는 소리 내어 읽어 줄 안내문이다. 첫 번째 버튼의 위치와 이름만 짧고 쉬운 한 문장으로 말한다.",
    "결제 단계라면 금액을 확인하라고 덧붙인다.",
    "confidence는 이 안내가 맞다는 확신이다. 버튼 글자가 또렷이 보이고 목표와 분명히 맞으면 high, 비슷한 버튼이 여럿이거나 일부만 보이면 medium, 짐작이거나 화면이 흐리면 low로 한다.",
    `stage, where, message는 ${answerLang}로 쓴다. button은 화면에 적힌 글자 그대로 쓴다.`,
  ].join("\n");

  const pressed = req.history.length > 0 ? req.history.join(" → ") : "없음";
  const user = `목표: ${req.goal}\n지금까지 누른 버튼: ${pressed}\n이 화면에서 다음에 누를 버튼을 알려 줘.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user, images: [req.image] },
  ];
}

/** 버튼을 못 찾았을 때(steps가 빔) 쓰는 고정 문구. 모델은 steps를 비우고도 버튼 이름을 안내해 버려서 코드가 정한다. */
export const RETRY_MESSAGE: Record<Lang, string> = {
  ko: "화면이 잘 안 보여요. 휴대폰을 멈추고 조금 더 가까이, 또렷하게 비춰 주세요.",
  en: "I can't see the screen clearly. Hold your phone still and point it a little closer.",
};

/** 1단계 출력(JSON 문자열)을 검증한다. 위치는 아직 없다(box: null). 형식이 틀리면 null. */
export function parseGuide(raw: string, lang: Lang = "ko"): Guide | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.message !== "string" || d.message.trim() === "") return null;

  const steps = readSteps(d.steps);
  const done = d.done === true;

  return {
    stage: typeof d.stage === "string" ? d.stage : "",
    button: steps[0]?.button ?? "",
    where: typeof d.where === "string" ? d.where : "",
    box: null,
    steps,
    // 누를 버튼이 하나도 없고 주문도 끝나지 않았다면 버튼을 못 찾은 것이니 다시 비춰 달라고만 안내한다.
    // 위치만 못 찾은 경우(steps는 있고 box가 null)는 음성 안내를 할 수 있으니 모델 문구를 그대로 쓴다.
    message: steps.length === 0 && !done ? RETRY_MESSAGE[lang] : d.message.trim(),
    done,
    // 값이 없거나 이상하면 low로 숨기지 않고 medium으로 둔다. 모델이 항목을 빼먹어도 안내가 사라지지 않게.
    confidence: d.confidence === "high" || d.confidence === "low" ? d.confidence : "medium",
  };
}

/**
 * 보통 다음 화면에 가야 나오는 선택지. 모델이 목표에 '포장'이 있으면 메뉴 화면에서도 2번으로 '포장'을 지어내고,
 * 위치 찾기는 없는 버튼도 비슷한 곳(전체삭제 등)에 상자를 그려 버려서, 2번부터는 이런 버튼을 뺀다.
 * 1번은 빼지 않는다. 포장·매장 고르는 화면에서는 그것이 지금 누를 버튼이기 때문이다.
 */
const NEXT_SCREEN_WORDS = ["포장", "매장", "먹고", "가져", "카드", "현금", "쿠폰", "적립", "영수증", "to go", "take", "dine", "eat", "card", "cash", "coupon", "receipt"];

function readSteps(value: unknown): Step[] {
  if (!Array.isArray(value)) return [];
  const steps: Step[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { button, kind } = item as Record<string, unknown>;
    if (typeof button !== "string" || button.trim() === "") continue;
    const name = button.trim();
    // 같은 버튼을 두 번 넣는 경우가 있어 한 번만 남긴다.
    if (steps.some((s) => s.button === name)) continue;
    if (steps.length > 0 && NEXT_SCREEN_WORDS.some((w) => name.toLowerCase().includes(w))) continue;
    steps.push({ button: name, kind: kind === "menu" ? "menu" : "button", box: null });
  }
  return steps.slice(0, MAX_STEPS);
}

/**
 * 2단계(위치 찾기) 요청. Qwen2.5-VL이 학습한 그대로의 영어 문장과 `bbox_2d` 출력 형식을 써야
 * 상자가 버튼 전체를 정확히 감싼다(실측: 같은 사진에서 1단계 JSON 좌표는 컵 일부만, 이 방식은 메뉴 칸 전체).
 * label에 번호를 달게 해서 어느 상자가 몇 번 버튼인지 맞춘다.
 */
export function buildLocateMessages(image: string, steps: Step[]) {
  // 1단계가 메뉴를 button으로 잘못 분류하면 "버튼"이라는 말에 끌려 탭에 상자가 갔다.
  // 그래서 종류는 힌트로만 주고, 화면에 적힌 글자로 찾게 한다.
  const lines = steps.map(
    (s, i) => `${i + 1}. "${s.button}" (${s.kind === "menu" ? "probably a menu item card" : "probably a button or tab"})`,
  );
  const content = [
    "Find these elements on the kiosk screen by the text written on them. Each one is either a menu item card (picture, name and price) or a button/tab.",
    "Output their bbox coordinates in JSON format. For a menu item card, the box covers the whole card.",
    'Use the element number as the label, e.g. {"bbox_2d": [x1, y1, x2, y2], "label": "1"}.',
    ...lines,
  ].join("\n");
  return [{ role: "user", content, images: [image] }];
}

/**
 * 2단계 출력에서 번호별 상자를 읽어 steps에 붙인다. 못 찾은 버튼은 box가 null로 남는다.
 * 출력은 ```json 블록 안의 배열이라 JSON.parse 대신 bbox_2d 항목을 하나씩 찾는다.
 */
export function attachBoxes(guide: Guide, raw: string, width: number, height: number): Guide {
  const boxes: (Box | null)[] = guide.steps.map(() => null);
  const items = raw.match(/\{[^{}]*"bbox_2d"[^{}]*\}/g) ?? [];
  items.forEach((item, order) => {
    const nums = item.match(/"bbox_2d"\s*:\s*\[([^\]]*)\]/)?.[1].split(",").map(Number);
    const label = Number(item.match(/"label"\s*:\s*"?\s*(\d+)/)?.[1]);
    // 번호가 없거나 범위를 벗어나면 나온 순서대로 맞춘다.
    const index = Number.isInteger(label) && label >= 1 && label <= boxes.length ? label - 1 : order;
    if (index < boxes.length && boxes[index] === null) boxes[index] = toBox(nums, width, height);
  });
  const steps = guide.steps.map((s, i) => ({ ...s, box: boxes[i] }));
  return { ...guide, steps, box: steps[0]?.box ?? null };
}

/** 3단계(검증) 출력 스키마. 잘라 낸 조각에 그 버튼이 있는지 예/아니오로만 받는다. */
export const verifySchema = {
  type: "object",
  properties: { answer: { type: "string", enum: ["yes", "no"] } },
  required: ["answer"],
} as const;

/** 상자 둘레를 25%씩 넓혀서 사진에서 잘라 낼 영역(픽셀). 사진 밖으로 나가지 않게 맞춘다. */
export function cropRegion(box: Box, width: number, height: number) {
  const padX = box.width * 0.25;
  const padY = box.height * 0.25;
  const left = Math.max(0, Math.floor((box.left - padX) * width));
  const top = Math.max(0, Math.floor((box.top - padY) * height));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.ceil((box.width + 2 * padX) * width))),
    height: Math.max(1, Math.min(height - top, Math.ceil((box.height + 2 * padY) * height))),
  };
}

/**
 * 3단계(검증) 요청. 위치 찾기가 고른 상자만 잘라서, 정말 그 버튼인지 다시 묻는다.
 * 49문항 시험에서 이 확인을 통과한 안내만 보여 주면 틀린 안내가 22개에서 6개로 줄었다(맞는 안내는 27개 중 20개 유지).
 * 영어 문장을 쓰는 것은 위치 찾기와 같은 이유로 Qwen2.5-VL이 더 안정적이기 때문이다.
 */
export function buildVerifyMessages(crop: string, button: string) {
  const content = `This image is a crop of a kiosk screen. Is there a button or menu card labeled "${button}" in this crop? Answer yes or no.`;
  return [{ role: "user", content, images: [crop] }];
}

/** 검증 출력을 읽는다. 맞다 true, 아니다 false, 읽지 못했으면 null(이때는 안내를 그대로 둔다). */
export function parseVerify(raw: string): boolean | null {
  try {
    const answer = (JSON.parse(raw) as { answer?: unknown }).answer;
    return answer === "yes" ? true : answer === "no" ? false : null;
  } catch {
    return null;
  }
}

/** 검증에서 틀렸다고 나온 안내를 거둔다. 버튼 목록을 비우면 웹은 다음 장면을 다시 분석한다. */
export function rejectGuide(guide: Guide, lang: Lang): Guide {
  return { ...guide, button: "", where: "", box: null, steps: [], message: RETRY_MESSAGE[lang], confidence: "low" };
}

function toBox(value: unknown, width: number, height: number): Box | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  // 모델이 가끔 픽셀 대신 0~1 비율로 답하면 픽셀로 바꿔서 같은 검증을 거친다.
  const ratio = value.every((n) => n >= 0 && n <= 1);
  const [a, b, c, d] = ratio
    ? [value[0] * width, value[1] * height, value[2] * width, value[3] * height]
    : (value as number[]);
  // 사진 밖으로 크게 벗어난 좌표는 크기를 잘못 본 것이라 버린다(조금 넘는 것만 잘라 낸다).
  const slack = 1.05;
  if (Math.max(a, c) > width * slack || Math.max(b, d) > height * slack) return null;
  const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);
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
