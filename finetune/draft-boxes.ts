// 학습 사진마다 눌러야 할 버튼 목록을 만들고, 7B로 상자 초안을 그려 finetune/data/boxes/labels.jsonl에 쓴다.
// 초안은 draft: true로 표시된다. 라벨링 도구로 하나씩 확인하거나 고치면 draft가 false가 된다.
//
// 실행: node finetune/draft-boxes.ts [--model qwen2.5vl:7b] [--only IMG_1616]
// 이미 있는 labels.jsonl은 덮어쓰지 않는다(확인한 상자를 잃지 않게). 다시 만들려면 파일을 지우고 실행한다.
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const { values: args } = parseArgs({ options: { model: { type: "string", default: "qwen2.5vl:7b" }, only: { type: "string" } } });
const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, "finetune", "data", "boxes");
const labelFile = path.join(dataDir, "labels.jsonl");
const g = await import(pathToFileURL(path.join(root, "lib", "guide.ts")).href);

try {
  await access(labelFile);
  if (!args.only) {
    console.error(`${labelFile}이 이미 있어요. 확인한 상자를 덮어쓰지 않으려고 멈춥니다. 다시 만들려면 파일을 지우세요.`);
    process.exit(1);
  }
} catch {}

type Target = { button: string; kind: "menu" | "button" };

// 메가엠지씨커피 키오스크의 위쪽 탭(모든 메뉴 화면에 같다).
const TABS = ["신메뉴", "추천메뉴", "커피", "디카페인", "음료", "티", "푸드", "상품"];

// 단계 화면은 screens.json에 버튼 목록이 없어서 사진을 보고 정했다. 섹션 제목·안내 문구처럼 누르지 않는 글자는 뺐다.
const STEP_TARGETS: Record<string, string[]> = {
  STEP_option: ["주문담기", "샷 추가", "2샷 추가", "연하게", "텀블러(개인컵) 사용", "취소", "초기화"],
  STEP_cart: ["결제하기", "전체삭제"],
  STEP_confirm: ["먹고가기(다회용컵)", "포장하기(일회용컵)", "돌아가기"],
  STEP_payment: ["카드결제(삼성페이/LG페이)", "쿠폰사용", "카카오페이", "네이버페이", "KT VIP초이스", "SKT 우주패스", "X"],
  STEP_stamp: ["적립", "X", "010", "←"],
  STEP_stamp_done: ["확인"],
};

const screens = JSON.parse(await readFile(path.join(root, "finetune", "data", "screens.json"), "utf8"));
const plan: { id: string; targets: Target[] }[] = [];
for (const m of screens.menu_screens) {
  const t: Target[] = [
    ...TABS.map((b) => ({ button: b, kind: "button" as const })),
    ...m.subtabs.map((b: string) => ({ button: b, kind: "button" as const })),
    ...m.items.map(([name]: [string]) => ({ button: name, kind: "menu" as const })),
    ...(m.has_prev ? [{ button: "< 이전", kind: "button" as const }] : []),
    ...(m.has_next ? [{ button: "다음 >", kind: "button" as const }] : []),
    { button: "전체삭제", kind: "button" },
    ...(m.cart.length > 0 ? [{ button: "결제하기", kind: "button" as const }] : []),
    { button: "처음으로", kind: "button" },
  ];
  plan.push({ id: m.id, targets: t });
}
for (const [id, names] of Object.entries(STEP_TARGETS)) plan.push({ id, targets: names.map((button) => ({ button, kind: "button" })) });

async function chat(messages: unknown[]) {
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    body: JSON.stringify({ model: args.model, stream: false, options: { temperature: 0, num_predict: 600 }, messages }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  return ((await res.json()) as { message?: { content?: string } }).message?.content ?? "";
}

// 앱(app/frame.ts)과 같은 크기로 보낸다. 98만 픽셀 이하, 28의 배수로 내림.
const fit = (w: number, h: number) => {
  const s = Math.sqrt(980_000 / (w * h));
  const f = (n: number) => Math.max(28, Math.floor((n * s) / 28) * 28);
  return { width: f(w), height: f(h) };
};

const BATCH = 4; // 한 번에 너무 많이 물으면 번호를 섞어서 몇 개씩 나눠 묻는다.
const lines: string[] = [];
for (const { id, targets } of plan) {
  if (args.only && id !== args.only) continue;
  const file = `${id}.jpg`;
  const { data, info } = await sharp(path.join(dataDir, "images", file)).rotate().toBuffer({ resolveWithObject: true });
  const size = fit(info.width, info.height);
  const image = (await sharp(data).resize(size.width, size.height, { fit: "fill" }).jpeg({ quality: 85 }).toBuffer()).toString("base64");
  let found = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const steps = targets.slice(i, i + BATCH).map((t) => ({ ...t, box: null }));
    const guide = { stage: "", button: "", where: "", box: null, steps, message: "-", done: false, confidence: "high" };
    const located = g.attachBoxes(guide, await chat(g.buildLocateMessages(image, steps)), size.width, size.height);
    located.steps.forEach((s: { button: string; kind: string; box: { left: number; top: number; width: number; height: number } | null }, j: number) => {
      const b = s.box;
      const box = b
        ? [b.left * info.width, b.top * info.height, (b.left + b.width) * info.width, (b.top + b.height) * info.height].map(Math.round)
        : null;
      if (box) found++;
      lines.push(JSON.stringify({
        id: `${id}-${i + j + 1}`, image: `images/${file}`, store: "메가엠지씨커피", source: "photo", goal: "(상자 라벨)", history: [],
        answer: { button: s.button, box }, kind: s.kind, draft: true,
      }));
    });
  }
  console.log(`${id}: ${targets.length}개 중 ${found}개 상자 초안`);
}
await writeFile(labelFile, lines.join("\n") + "\n", { encoding: "utf8", flag: args.only ? "a" : "w" });
console.log(`저장: ${labelFile} (${lines.length}줄)`);
