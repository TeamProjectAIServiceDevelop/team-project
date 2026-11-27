// 앱 /api/guide의 1·2단계를 그대로 Ollama에 직접 보내 49문항을 잰다. 모델 이름만 바꿔 여러 모델을 비교한다.
// 개발 서버 없이 돌고, npm run eval과 같은 기준(이름 일치, 상자 중심이 정답 상자 안)으로 센다.
//
// 실행: node finetune/compare.ts kiosk-7b-conv kiosk-7b-ft [--data eval/data/mega]
// 결과: 모델마다 이름/위치/둘 다 맞은 수, 그리고 문항별 결과를 eval/results/<시각>-compare-<모델>.jsonl에 저장한다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const { values: args, positionals: models } = parseArgs({ options: { data: { type: "string", default: "eval/data/mega" } }, allowPositionals: true });
if (models.length === 0) {
  console.error("비교할 Ollama 모델 이름을 적어 주세요. 예: node finetune/compare.ts kiosk-7b-conv kiosk-7b-ft");
  process.exit(1);
}
const root = path.resolve(import.meta.dirname, "..");
const g = await import(pathToFileURL(path.join(root, "lib", "guide.ts")).href);
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

// lib/ollama.ts의 chat과 같은 옵션. (그 파일은 생성자 매개변수 속성 때문에 node의 타입 제거로 불러올 수 없다.)
async function chat(model: string, messages: unknown[], format?: object): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: false, ...(format ? { format } : {}), options: { temperature: 0, num_predict: 600 }, messages }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { message?: { content?: string } }).message?.content ?? "";
}

// 앱(app/frame.ts)과 같은 크기: 98만 픽셀 이하, 28의 배수로 내림.
const fit = (w: number, h: number) => {
  const s = Math.sqrt(980_000 / (w * h));
  const f = (n: number) => Math.max(28, Math.floor((n * s) / 28) * 28);
  return { width: f(w), height: f(h) };
};
const norm = (t: string) => t.normalize("NFC").toLowerCase().replace(/[\s'"‘’“”.,!?·()[\]]/g, "");

const dataDir = path.resolve(root, args.data);
const items = (await readFile(path.join(dataDir, "labels.jsonl"), "utf8")).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim()).map((l) => ({ history: [], ...JSON.parse(l) }));
const images = new Map<string, { image: string; width: number; height: number; origW: number; origH: number }>();
for (const item of items) {
  if (images.has(item.image)) continue;
  const { data, info } = await sharp(path.join(dataDir, item.image)).rotate().toBuffer({ resolveWithObject: true });
  const size = fit(info.width, info.height);
  const image = (await sharp(data).resize(size.width, size.height, { fit: "fill" }).jpeg({ quality: 85 }).toBuffer()).toString("base64");
  images.set(item.image, { image, ...size, origW: info.width, origH: info.height });
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
await mkdir(path.join(root, "eval", "results"), { recursive: true });
const summary: string[] = [];
for (const model of models) {
  const rows: { id: string; answer: string; ai: string; nameOk: boolean; posOk: boolean; error: string; ms: number }[] = [];
  for (const item of items) {
    const img = images.get(item.image)!;
    const started = performance.now();
    const row = { id: item.id, answer: item.answer.button, ai: "", nameOk: false, posOk: false, error: "", ms: 0 };
    try {
      let guide = g.parseGuide(await chat(model, g.buildMessages({ image: img.image, width: img.width, height: img.height, goal: item.goal, history: item.history, lang: "ko" }), g.guideSchema), "ko");
      if (!guide) row.error = "1단계 답을 읽지 못함";
      else {
        if (guide.steps.length > 0) guide = g.attachBoxes(guide, await chat(model, g.buildLocateMessages(img.image, guide.steps)), img.width, img.height);
        row.ai = guide.button;
        row.nameOk = !!row.ai && [item.answer.button, ...(item.answer.aliases ?? [])].some((n: string) => norm(n) === norm(row.ai));
        const b = guide.box;
        if (b) {
          const cx = (b.left + b.width / 2) * img.origW, cy = (b.top + b.height / 2) * img.origH;
          const [x1, y1, x2, y2] = item.answer.box;
          row.posOk = cx >= Math.min(x1, x2) && cx <= Math.max(x1, x2) && cy >= Math.min(y1, y2) && cy <= Math.max(y1, y2);
        }
      }
    } catch (e) {
      row.error = String((e as Error).message).slice(0, 120);
    }
    row.ms = Math.round(performance.now() - started);
    rows.push(row);
    console.log(`[${model}] ${row.id} 이름 ${row.nameOk ? "O" : "X"} 위치 ${row.posOk ? "O" : "X"} ${row.ms}ms AI:${row.ai || "(없음)"} 정답:${row.answer} ${row.error}`);
  }
  await writeFile(path.join(root, "eval", "results", `${stamp}-compare-${model.replace(/[^\w.-]/g, "_")}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  const n = rows.length, c = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  summary.push(`${model}: 이름 ${c((r) => r.nameOk)}/${n}, 위치 ${c((r) => r.posOk)}/${n}, 둘 다 ${c((r) => r.nameOk && r.posOk)}/${n}, 오류 ${c((r) => !!r.error)}, 평균 ${(rows.reduce((s, r) => s + r.ms, 0) / n / 1000).toFixed(1)}초`);
}
console.log("\n" + summary.join("\n"));
