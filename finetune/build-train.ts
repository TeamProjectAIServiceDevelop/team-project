// 상자 라벨(finetune/data/boxes/labels.jsonl)과 화면 정보(finetune/data/screens.json)로
// 앱과 똑같은 질문·답 형식의 학습 데이터를 만든다(LLaMA-Factory sharegpt 형식).
//
// - 1단계(버튼 고르기): lib/guide.ts의 buildMessages와 같은 system·user 문장, 답은 guideSchema 순서의 JSON.
// - 2단계(위치 찾기): buildLocateMessages와 같은 문장, 답은 Qwen2.5-VL이 내는 그대로의 ```json [{"bbox_2d", "label"}] 형식.
// - 사진은 앱(app/frame.ts)이 보내는 크기(98만 픽셀 이하, 28의 배수로 내림)로 미리 줄여 저장하고, 좌표도 그 크기 기준으로 쓴다.
//   학습 설정의 image_max_pixels를 이 크기 이상으로 두면 학습 중에 다시 줄이지 않아서 좌표가 앱과 맞는다.
// - 확인용 사진(screens.json의 val_screen_ids)은 kiosk_val.json으로만 간다. 49문항 평가 사진(eval/data/mega)은 쓰지 않는다.
//
// 실행: node finetune/build-train.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "finetune", "data", "train");
const g = await import(pathToFileURL(path.join(root, "lib", "guide.ts")).href);

type Box = [number, number, number, number];
type Label = { id: string; image: string; answer: { button: string; box: Box }; kind: "menu" | "button" };
type MenuScreen = { id: string; tab: string; subtab: string; subtabs: string[]; page: number; has_next: boolean; has_prev: boolean; cart: unknown[]; items: [string, number | null][] };
type Step = { button: string; kind: "menu" | "button" };

const labels: Label[] = (await readFile(path.join(root, "finetune", "data", "boxes", "labels.jsonl"), "utf8"))
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const screens = JSON.parse(await readFile(path.join(root, "finetune", "data", "screens.json"), "utf8"));
const menuScreens: MenuScreen[] = screens.menu_screens;
const valIds = new Set<string>(screens.val_screen_ids);

// 결과가 실행마다 같도록 고정 시드 난수를 쓴다.
let seed = 20261118;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const fit = (w: number, h: number) => {
  const s = Math.sqrt(980_000 / (w * h));
  const f = (n: number) => Math.max(28, Math.floor((n * s) / 28) * 28);
  return { width: f(w), height: f(h) };
};

// 사진마다: 앱 크기로 줄여 저장하고, 원본 좌표 → 줄인 좌표 변환을 준비한다.
const key = (button: string, kind: "menu" | "button") => `${kind}:${button}`;
type Photo = { id: string; file: string; width: number; height: number; origW: number; origH: number; boxes: Map<string, Label> };
const photos = new Map<string, Photo>();
await mkdir(path.join(outDir, "images"), { recursive: true });
for (const id of [...new Set(labels.map((l) => l.image.replace(/^images\/|\.jpg$/g, "")))]) {
  const src = path.join(root, "finetune", "data", "boxes", "images", `${id}.jpg`);
  const { data, info } = await sharp(src).rotate().toBuffer({ resolveWithObject: true });
  const size = fit(info.width, info.height);
  await sharp(data).resize(size.width, size.height, { fit: "fill" }).jpeg({ quality: 85 }).toFile(path.join(outDir, "images", `${id}.jpg`));
  // 이름과 종류를 함께 열쇠로 쓴다. IMG_1617처럼 하위 탭 "에스프레소"와 메뉴 "에스프레소"가 한 화면에 같이 있다.
  const boxes = new Map(labels.filter((l) => l.image === `images/${id}.jpg`).map((l) => [key(l.answer.button, l.kind), l]));
  photos.set(id, { id, file: `images/${id}.jpg`, ...size, origW: info.width, origH: info.height, boxes });
}
const toModel = (p: Photo, b: Box): Box =>
  [Math.round((b[0] * p.width) / p.origW), Math.round((b[1] * p.height) / p.origH), Math.round((b[2] * p.width) / p.origW), Math.round((b[3] * p.height) / p.origH)];

function where(p: Photo, s: Step) {
  const b = p.boxes.get(key(s.button, s.kind))!.answer.box;
  const x = (b[0] + b[2]) / 2 / p.origW, y = (b[1] + b[3]) / 2 / p.origH;
  const h = x < 0.34 ? "왼쪽" : x > 0.66 ? "오른쪽" : "가운데";
  const v = y < 0.34 ? "위" : y > 0.66 ? "아래" : "가운데";
  return h === "가운데" && v === "가운데" ? "화면 가운데" : h === "가운데" ? `화면 가운데 ${v}` : v === "가운데" ? `화면 ${h}` : `화면 ${h} ${v}`;
}

type Sample = { messages: { role: string; content: string }[]; images: string[] };
const train: Sample[] = [], val: Sample[] = [];
const push = (p: Photo, s: Sample) => (valIds.has(p.id) ? val : train).push(s);

/** 1단계 샘플. steps는 이 사진에 상자가 있는 버튼만 받는다. */
function guideSample(p: Photo, goal: string, history: string[], stage: string, steps: Step[], extra = "") {
  for (const s of steps) if (!p.boxes.has(key(s.button, s.kind))) throw new Error(`${p.id}에 없는 버튼: ${s.kind} ${s.button}`);
  const [system, user] = g.buildMessages({ image: "", width: p.width, height: p.height, goal, history, lang: "ko" });
  const first = steps[0];
  const w = where(p, first);
  const answer = {
    stage,
    where: w,
    steps,
    message: `${w}에 있는 '${first.button}' ${first.kind === "menu" ? "메뉴를" : "버튼을"} 누르세요.${extra}`,
    done: false,
    confidence: "high",
  };
  push(p, {
    messages: [
      { role: "system", content: system.content },
      { role: "user", content: "<image>" + user.content },
      { role: "assistant", content: JSON.stringify(answer, null, 2) },
    ],
    images: [p.file],
  });
}

/** 2단계 샘플: 번호를 붙인 버튼들의 상자. */
function locateSample(p: Photo, steps: Step[]) {
  const [msg] = g.buildLocateMessages("", steps.map((s) => ({ ...s, box: null })));
  const lines = steps.map((s, i) => `    {"bbox_2d": [${toModel(p, p.boxes.get(key(s.button, s.kind))!.answer.box).join(", ")}], "label": "${i + 1}"}`);
  push(p, {
    messages: [
      { role: "user", content: "<image>" + msg.content },
      { role: "assistant", content: "```json\n[\n" + lines.join(",\n") + "\n]\n```" },
    ],
    images: [p.file],
  });
}

// ---------- 메뉴 화면 ----------
const FOOD_TABS = new Set(["푸드"]);
const PROMO_TABS = new Set(["신메뉴", "추천메뉴"]);
const goalFor = (name: string, tab: string) => {
  const unit = FOOD_TABS.has(tab) ? "하나" : "한 잔";
  return pick([`${name} ${unit} 주문`, `${name} ${unit} 주세요`, `${name} 먹고 싶어`, `${name} ${unit} 포장`, `${name} 주문하고 싶어`]);
};
/** 이 화면에 오기까지 누른 버튼(처음 화면은 신메뉴 첫 하위 탭). */
const pathTo = (m: MenuScreen) => [
  ...(m.tab === "신메뉴" ? [] : [m.tab]),
  ...(m.subtab !== m.subtabs[0] ? [m.subtab] : []),
  ...(m.page > 1 ? ["다음 >"] : []),
];
// 메뉴 이름 → 그 메뉴가 있는 화면들. 다른 화면에서 찾아갈 때는 신메뉴·추천메뉴보다 원래 탭을 고른다.
const homes = new Map<string, MenuScreen[]>();
for (const m of menuScreens) for (const [name] of m.items) homes.set(name, [...(homes.get(name) ?? []), m]);
const homeOf = (name: string) => { const hs = homes.get(name)!; return hs.find((h) => !PROMO_TABS.has(h.tab)) ?? hs[0]; };

let counts = { here: 0, nav: 0, misc: 0, step: 0, locate: 0 };
for (const m of menuScreens) {
  const p = photos.get(m.id)!;
  const history = pathTo(m);
  const pay = p.boxes.has(key("결제하기", "button")) ?[{ button: "결제하기", kind: "button" as const }] : [];
  // (가) 이 화면에 있는 메뉴: 그 칸, 이어서 결제하기
  for (const [name] of m.items) {
    guideSample(p, goalFor(name, m.tab), history, "메뉴 선택", [{ button: name, kind: "menu" }, ...pay]);
    counts.here++;
  }
  // (나) 이 화면에 없는 메뉴: 그 메뉴가 있는 탭·하위 탭·페이지로 가는 버튼
  const others = shuffle([...homes.keys()].filter((n) => !m.items.some(([x]) => x === n))).slice(0, 10);
  for (const name of others) {
    const t = homeOf(name);
    const go = t.tab !== m.tab ? t.tab : t.subtab !== m.subtab ? t.subtab : t.page > m.page ? "다음 >" : "< 이전";
    guideSample(p, goalFor(name, t.tab), history, "메뉴 선택", [{ button: go, kind: "button" }]);
    counts.nav++;
  }
  // (다) 그 밖의 버튼
  if (pay.length) { guideSample(p, pick(["장바구니에 담은 것 결제", "다 골랐어 이제 결제할래", "주문한 거 계산하고 싶어"]), [...history, "주문담기"], "장바구니", pay, " 결제 금액을 확인하세요."); counts.misc++; }
  guideSample(p, pick(["장바구니 다 비우고 싶어", "담은 거 전부 지워 줘"]), history, "메뉴 선택", [{ button: "전체삭제", kind: "button" }]); counts.misc++;
  guideSample(p, pick(["처음 화면으로 돌아갈래", "처음부터 다시 볼래"]), history, "메뉴 선택", [{ button: "처음으로", kind: "button" }]); counts.misc++;
}

// ---------- 단계 화면 ----------
type StepCase = { goal: string; history?: string[]; steps: string[]; extra?: string };
const STEP_CASES: Record<string, { stage: string; cases: StepCase[] }> = {
  STEP_option: { stage: "옵션 선택", cases: [
    { goal: "(ICE)아메리카노 한 잔 주문", history: ["커피", "(ICE)아메리카노"], steps: ["주문담기"] },
    { goal: "아이스 아메리카노 그냥 담아 줘", history: ["커피", "(ICE)아메리카노"], steps: ["주문담기"] },
    { goal: "(ICE)아메리카노 샷 추가해서 주문", history: ["커피", "(ICE)아메리카노"], steps: ["샷 추가", "주문담기"] },
    { goal: "아메리카노 진하게 2샷 추가", history: ["커피", "(ICE)아메리카노"], steps: ["2샷 추가", "주문담기"] },
    { goal: "아메리카노 연하게 주문", history: ["커피", "(ICE)아메리카노"], steps: ["연하게", "주문담기"] },
    { goal: "텀블러에 아메리카노 받을래", history: ["커피", "(ICE)아메리카노"], steps: ["텀블러(개인컵) 사용", "주문담기"] },
    { goal: "고른 옵션 다 지우고 다시 고를래", history: ["커피", "(ICE)아메리카노", "샷 추가"], steps: ["초기화"] },
    { goal: "이 메뉴 안 살래 취소", history: ["커피", "(ICE)아메리카노"], steps: ["취소"] },
  ] },
  STEP_cart: { stage: "장바구니", cases: [
    { goal: "담은 메뉴 결제", history: ["커피", "(ICE)아메리카노", "주문담기"], steps: ["결제하기"], extra: " 결제 금액을 확인하세요." },
    { goal: "아이스 아메리카노 한 잔 포장", history: ["커피", "(ICE)아메리카노", "주문담기"], steps: ["결제하기"], extra: " 결제 금액을 확인하세요." },
    { goal: "장바구니 다 비울래", history: ["커피", "(ICE)아메리카노", "주문담기"], steps: ["전체삭제"] },
    { goal: "에스프레소 메뉴 더 보고 싶어", history: ["커피"], steps: ["다음 >"] },
  ] },
  STEP_confirm: { stage: "주문 확인", cases: [
    { goal: "주문한 거 포장해 갈래", history: ["결제하기"], steps: ["포장하기(일회용컵)"] },
    { goal: "아이스 아메리카노 한 잔 포장", history: ["결제하기"], steps: ["포장하기(일회용컵)"] },
    { goal: "매장에서 먹고 갈게", history: ["결제하기"], steps: ["먹고가기(다회용컵)"] },
    { goal: "여기서 마시고 갈래", history: ["결제하기"], steps: ["먹고가기(다회용컵)"] },
    { goal: "메뉴 더 고를래 돌아가기", history: ["결제하기"], steps: ["돌아가기"] },
  ] },
  STEP_payment: { stage: "결제", cases: [
    { goal: "카드로 결제", steps: ["카드결제(삼성페이/LG페이)"] },
    { goal: "삼성페이로 낼래", steps: ["카드결제(삼성페이/LG페이)"] },
    { goal: "카카오페이로 결제", steps: ["카카오페이"] },
    { goal: "네이버페이로 결제할래", steps: ["네이버페이"] },
    { goal: "페이코로 결제", steps: ["페이코"] },
    { goal: "제로페이로 결제", steps: ["제로페이"] },
    { goal: "KB Pay로 결제", steps: ["KB Pay"] },
    { goal: "하나 Pay로 결제", steps: ["하나 Pay"] },
    { goal: "페이북으로 결제", steps: ["BC페이북"] },
    { goal: "앱카드 QR로 결제", steps: ["앱카드"] },
    { goal: "메가선불카드로 결제", steps: ["메가선불카드"] },
    { goal: "CJ기프트카드로 결제", steps: ["CJ기프트카드"] },
    { goal: "기프티콘 쿠폰 쓸래", steps: ["쿠폰사용"] },
    { goal: "KT VIP 할인 받을래", steps: ["KT VIP초이스"] },
    { goal: "SKT 우주패스 할인 받고 싶어", steps: ["SKT 우주패스"] },
    { goal: "CJ ONE 포인트 쓸래", steps: ["CJ ONE 포인트 사용"] },
    { goal: "결제 화면 닫을래", steps: ["X"] },
  ] },
  STEP_stamp: { stage: "스탬프 적립", cases: [
    { goal: "번호 다 눌렀어 스탬프 적립", steps: ["적립"] },
    { goal: "스탬프 적립 안 할래", steps: ["X"] },
    { goal: "번호 하나 잘못 눌렀어", steps: ["←"] },
    { goal: "휴대폰 번호 앞자리 010 입력", steps: ["010"] },
  ] },
  STEP_stamp_done: { stage: "스탬프 적립 완료", cases: [
    { goal: "스탬프 적립 끝났어 다음으로", steps: ["확인"] },
  ] },
};
for (const [id, { stage, cases }] of Object.entries(STEP_CASES)) {
  const p = photos.get(id)!;
  for (const c of cases) {
    guideSample(p, c.goal, c.history ?? ["결제하기"], stage, c.steps.map((button) => ({ button, kind: "button" })), c.extra ?? "");
    counts.step++;
  }
}

// ---------- 2단계(위치 찾기) ----------
// 사진마다 모든 버튼이 두 번씩 나오도록, 섞어서 1~3개씩 묶는다. 묶음 크기가 다양해야 앱의 1~3개 질문에 모두 익숙해진다.
for (const p of photos.values()) {
  const all = [...p.boxes.values()].map((l) => ({ button: l.answer.button, kind: l.kind }));
  for (let round = 0; round < 2; round++) {
    const order = shuffle(all);
    for (let i = 0; i < order.length;) {
      const n = 1 + Math.floor(rand() * 3);
      locateSample(p, order.slice(i, i + n));
      i += n; counts.locate++;
    }
  }
}

await writeFile(path.join(outDir, "kiosk_train.json"), JSON.stringify(shuffle(train), null, 1), "utf8");
await writeFile(path.join(outDir, "kiosk_val.json"), JSON.stringify(val, null, 1), "utf8");
const info = (file: string) => ({
  file_name: file, formatting: "sharegpt", columns: { messages: "messages", images: "images" },
  tags: { role_tag: "role", content_tag: "content", user_tag: "user", assistant_tag: "assistant", system_tag: "system" },
});
await writeFile(path.join(outDir, "dataset_info.json"), JSON.stringify({ kiosk_train: info("kiosk_train.json"), kiosk_val: info("kiosk_val.json") }, null, 2), "utf8");
console.log(`학습 ${train.length}개, 확인용 ${val.length}개`, counts);
console.log(`사진 크기: ${[...new Set([...photos.values()].map((p) => `${p.width}x${p.height}`))].join(", ")}`);
