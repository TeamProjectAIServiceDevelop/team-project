// Ollama에 올린 모델을 앱과 똑같은 코드(lib/guide.ts, lib/ollama.ts)로 확인용 데이터에서 채점한다.
// 1단계는 guideSchema로 JSON 형식을 강제하고 parseGuide로 읽는다. 이름이 맞으면 2단계(buildLocateMessages → attachBoxes)로
// 상자를 받아, 상자 중심이 정답 상자 안이면 위치도 맞음. 정답 상자는 같은 사진의 2단계 문항에서 가져온다.
//
// 실행 (저장소 루트): $env:OLLAMA_MODEL = "kiosk-3b-button"; node_modules\.bin\jiti finetune\eval-ollama.ts [데이터 폴더]
//   데이터 폴더 기본값: finetune/data/train-3b (사진도 그 폴더의 images/, 학습 때와 같은 크기)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const g = await import(pathToFileURL(path.join(root, "lib", "guide.ts")).href);
const { chat } = await import(pathToFileURL(path.join(root, "lib", "ollama.ts")).href);
const dataDir = path.resolve(root, process.argv[2] ?? "finetune/data/train-3b");
const model = process.env.OLLAMA_MODEL ?? "qwen2.5vl:3b";

type Msg = { role: string; content: string };
type Sample = { messages: Msg[]; images: string[] };
const val: Sample[] = JSON.parse(readFileSync(path.join(dataDir, "kiosk_val.json"), "utf8"));

// 정답 상자: "사진|버튼" → [x1, y1, x2, y2] (줄인 사진 픽셀)
const gold = new Map<string, number[]>();
for (const s of val) {
  if (s.messages[0].role !== "user") continue;
  const names = [...s.messages[0].content.matchAll(/^\d+\. "(.*)" \(probably/gm)].map((m) => m[1]);
  const boxes = [...s.messages[1].content.matchAll(/"bbox_2d": \[([^\]]*)\]/g)].map((m) => m[1].split(",").map(Number));
  names.forEach((n, i) => gold.set(`${s.images[0]}|${n}`, boxes[i]));
}

const images = new Map<string, { b64: string; width: number; height: number }>();
async function image(file: string) {
  if (!images.has(file)) {
    const buf = readFileSync(path.join(dataDir, file));
    const { width, height } = await sharp(buf).metadata();
    images.set(file, { b64: buf.toString("base64"), width: width!, height: height! });
  }
  return images.get(file)!;
}

const rows: object[] = [];
let n = 0, nameOk = 0, both = 0, fail = 0, ms = 0;
for (const s of val) {
  if (s.messages[0].role !== "system") continue;
  n++;
  const img = await image(s.images[0]);
  const answer = JSON.parse(s.messages[2].content).steps[0].button as string;
  const started = Date.now();
  let ai = "", pos = false, error = "";
  try {
    const raw = await chat([{ role: "system", content: s.messages[0].content }, { role: "user", content: s.messages[1].content.replace("<image>", ""), images: [img.b64] }], g.guideSchema);
    let guide = g.parseGuide(raw, "ko");
    if (!guide) error = "1단계 답을 읽지 못함";
    else {
      ai = guide.button ?? guide.steps[0]?.button ?? "";
      if (ai === answer && guide.steps.length > 0) {
        guide = g.attachBoxes(guide, await chat(g.buildLocateMessages(img.b64, guide.steps)), img.width, img.height);
        const b = guide.box, t = gold.get(`${s.images[0]}|${answer}`);
        if (b && t) {
          const cx = (b.left + b.width / 2) * img.width, cy = (b.top + b.height / 2) * img.height;
          pos = cx >= Math.min(t[0], t[2]) && cx <= Math.max(t[0], t[2]) && cy >= Math.min(t[1], t[3]) && cy <= Math.max(t[1], t[3]);
        }
      }
    }
  } catch (e) {
    error = String((e as Error).message).slice(0, 120);
  }
  const t = Date.now() - started;
  ms += t;
  if (ai === answer) nameOk++;
  if (ai === answer && pos) both++;
  if (error) fail++;
  rows.push({ image: s.images[0], answer, ai, nameOk: ai === answer, posOk: pos, error, ms: t });
  console.log(`${s.images[0]} 이름 ${ai === answer ? "O" : "X"} 위치 ${pos ? "O" : "X"} ${t}ms AI:${ai || "(없음)"} 정답:${answer} ${error}`);
}
const summary = `${model}: 이름 ${nameOk}/${n}, 이름+위치 ${both}/${n}, 오류 ${fail}, 평균 ${(ms / n / 1000).toFixed(1)}초`;
console.log("\n" + summary);
writeFileSync(path.join(dataDir, `eval-ollama-${model.replace(/[^\w.-]/g, "_")}.json`), JSON.stringify({ summary, rows }, null, 1), "utf8");
