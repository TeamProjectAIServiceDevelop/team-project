// 평가 스크립트: 정답을 붙인 키오스크 사진을 /api/guide에 보내 버튼 안내 정확도, 위치 정확도, 응답 시간을 잰다.
// 사용법과 데이터 형식은 eval/README.md 참고.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";

const { values: args } = parseArgs({
  options: {
    data: { type: "string" },
    name: { type: "string", default: "run" },
    url: { type: "string", default: "http://localhost:3000/api/guide" },
    lang: { type: "string", default: "ko" },
    limit: { type: "string" },
    // 사진을 이 픽셀 수(가로×세로)에 맞춰 키우거나 줄여서 보낸다. 0이면 긴 변 1024 이하로 줄이기만 한다.
    pixels: { type: "string", default: "0" },
  },
});

if (!args.data) {
  console.error("데이터 폴더를 지정해 주세요. 예: npm run eval -- --data eval/data/sample");
  process.exit(1);
}

const TIME_LIMIT_MS = 5000; // 응답 시간 목표

// 앱(app/frame.ts)과 같은 방식으로 사진을 줄인다. 긴 변은 1024 이하, 가로·세로는 28의 배수.
const MAX_SIDE = 1024;
const PATCH = 28;

function fitSize(width, height) {
  const target = Number(args.pixels);
  // Ollama는 사진 크기와 상관없이 이미지를 안쪽에서 일정 크기로 바꾸고, 모델은 그 크기 기준 좌표를 낸다.
  // 작은 사진을 그대로 보내면 좌표가 어긋나므로, 그 크기 근처로 맞춰 보낼 수 있게 한다.
  const scale = target > 0 ? Math.sqrt(target / (width * height)) : Math.min(1, MAX_SIDE / Math.max(width, height));
  // --pixels를 줄 때는 실제 앱(app/frame.ts)처럼 28의 배수로 내림한다. 반올림하면 Ollama 상한을 넘어 좌표가 어긋날 수 있고,
  // 크기가 28 단위만 달라도 모델 답이 달라지므로 앱과 같은 방식으로 재야 점수가 앱의 정확도를 뜻한다.
  const snap = target > 0 ? Math.floor : Math.round;
  const round = (n) => Math.max(PATCH, snap((n * scale) / PATCH) * PATCH);
  return { width: round(width), height: round(height) };
}

async function loadImage(file) {
  // rotate(): 휴대폰 사진의 회전 정보(EXIF)를 반영해 똑바로 보이는 방향으로 맞춘다. 라벨 좌표도 이 방향 기준이다.
  const { data, info } = await sharp(file).rotate().toBuffer({ resolveWithObject: true });
  const size = fitSize(info.width, info.height);
  const jpeg = await sharp(data).resize(size.width, size.height, { fit: "fill" }).jpeg({ quality: 85 }).toBuffer();
  return { base64: jpeg.toString("base64"), ...size, origWidth: info.width, origHeight: info.height };
}

async function readLabels(dir) {
  const file = path.join(dir, "labels.jsonl");
  // 메모장·PowerShell이 붙이는 BOM을 떼어 낸다. 남아 있으면 첫 줄을 JSON으로 읽지 못한다.
  const lines = (await readFile(file, "utf8")).replace(/^﻿/, "").split(/\r?\n/);
  const items = [];
  const problems = [];
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      problems.push(`${i + 1}번째 줄: JSON 형식이 아니에요.`);
      return;
    }
    const missing = ["id", "image", "store", "source", "goal"].filter((k) => typeof item[k] !== "string" || item[k] === "");
    if (typeof item.answer?.button !== "string" || item.answer.button === "") missing.push("answer.button");
    const box = item.answer?.box;
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) missing.push("answer.box");
    if (missing.length > 0) {
      problems.push(`${i + 1}번째 줄(${item.id ?? "id 없음"}): ${missing.join(", ")} 확인 필요`);
      return;
    }
    items.push({ history: [], ...item });
  });
  if (problems.length > 0) {
    console.error(`${file}에 고칠 곳이 있어요.\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  return items;
}

/** 띄어쓰기, 대소문자, 따옴표·문장부호 차이는 무시하고 버튼 이름을 비교한다. */
function normalize(text) {
  return text.normalize("NFC").toLowerCase().replace(/[\s'"‘’“”.,!?·()[\]]/g, "");
}

function isButtonCorrect(answer, aiButton) {
  if (typeof aiButton !== "string" || aiButton === "") return false;
  const names = [answer.button, ...(answer.aliases ?? [])];
  return names.some((name) => normalize(name) === normalize(aiButton));
}

/** AI 상자(사진 대비 비율)의 중심이 정답 상자(원본 픽셀) 안에 있는지. */
function isPositionCorrect(answer, aiBox, image) {
  if (!aiBox) return false;
  const cx = (aiBox.left + aiBox.width / 2) * image.origWidth;
  const cy = (aiBox.top + aiBox.height / 2) * image.origHeight;
  const [a, b, c, d] = answer.box;
  return cx >= Math.min(a, c) && cx <= Math.max(a, c) && cy >= Math.min(b, d) && cy <= Math.max(b, d);
}

async function ask(item, image) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(args.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: image.base64,
        width: image.width,
        height: image.height,
        goal: item.goal,
        history: item.history,
        lang: args.lang,
      }),
    });
  } catch (error) {
    return { connectFailed: true, error: String(error.cause?.code ?? error.message) };
  }
  const body = await res.json().catch(() => ({}));
  const ms = Math.round(performance.now() - started);
  if (!res.ok) return { ms, error: body.error ?? `HTTP ${res.status}` };
  return { ms, guide: body };
}

function percent(n, total) {
  return total === 0 ? "-" : `${((n / total) * 100).toFixed(1)}%`;
}

function summarize(rows) {
  const answered = rows.filter((r) => !r.error);
  const times = answered.map((r) => r.ms).sort((a, b) => a - b);
  const mean = times.length ? times.reduce((s, t) => s + t, 0) / times.length : null;
  const median = times.length ? times[Math.floor((times.length - 1) / 2)] : null;
  return {
    total: rows.length,
    buttonCorrect: rows.filter((r) => r.buttonOk).length,
    positionCorrect: rows.filter((r) => r.positionOk).length,
    errors: rows.length - answered.length,
    meanMs: mean === null ? null : Math.round(mean),
    medianMs: median,
    maxMs: times.length ? times[times.length - 1] : null,
    within5s: times.filter((t) => t <= TIME_LIMIT_MS).length,
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const seconds = (ms) => (ms === null ? "-" : `${(ms / 1000).toFixed(1)}초`);

let items = await readLabels(args.data);
if (args.limit) items = items.slice(0, Number(args.limit));
console.log(`평가 시작: ${items.length}문항, ${args.url}\n`);

const rows = [];
for (const [i, item] of items.entries()) {
  const image = await loadImage(path.join(args.data, item.image));
  const result = await ask(item, image);
  if (result.connectFailed) {
    console.error(`앱 서버에 연결하지 못했어요(${result.error}). 다른 터미널에서 npm run dev가 켜져 있는지 확인해 주세요.`);
    process.exit(1);
  }
  const guide = result.guide;
  const row = {
    id: item.id,
    store: item.store,
    source: item.source,
    goal: item.goal,
    answerButton: item.answer.button,
    aiButton: guide?.button ?? "",
    confidence: guide?.confidence ?? "",
    buttonOk: isButtonCorrect(item.answer, guide?.button),
    positionOk: isPositionCorrect(item.answer, guide?.box, image),
    ms: result.ms,
    error: result.error ?? "",
    aiMessage: guide?.message ?? "",
  };
  rows.push(row);
  const mark = (ok) => (ok ? "O" : "X");
  const detail = row.error ? `오류: ${row.error}` : `AI: ${row.aiButton || "(없음)"}, 정답: ${row.answerButton}`;
  console.log(`[${i + 1}/${items.length}] ${item.id}  버튼 ${mark(row.buttonOk)}  위치 ${mark(row.positionOk)}  ${seconds(row.ms)}  ${detail}`);
}

const overall = summarize(rows);
// 사용자에게는 이름과 위치가 둘 다 맞아야 길 안내가 된다. 검증 단계가 안내를 거둔 문항(버튼 이름이 빈 것)은 따로 센다.
const shown = rows.filter((r) => !r.error && r.aiButton !== "");
const bothCorrect = shown.filter((r) => r.buttonOk && r.positionOk).length;
const stores = [...new Set(rows.map((r) => r.store))].map((store) => ({
  store,
  ...summarize(rows.filter((r) => r.store === store)),
}));

console.log(`
결과 (${args.name})
- 버튼 안내 정확도: ${percent(overall.buttonCorrect, overall.total)} (${overall.buttonCorrect}/${overall.total}, 목표 70%)
- 위치 정확도: ${percent(overall.positionCorrect, overall.total)} (${overall.positionCorrect}/${overall.total}, 목표 60%)
- 응답 시간: 평균 ${seconds(overall.meanMs)}, 중앙값 ${seconds(overall.medianMs)}, 최대 ${seconds(overall.maxMs)}, 5초 이내 ${percent(overall.within5s, overall.total - overall.errors)}
- 답을 못 받은 문항: ${overall.errors}개
- 안내를 보여 준 문항: ${shown.length}/${rows.length}, 그중 이름·위치 둘 다 맞음 ${bothCorrect}개 (${percent(bothCorrect, shown.length)}) / 틀린 안내 ${shown.length - bothCorrect}개, 안내를 거둔 문항 ${rows.length - shown.length}개
`);
// 확신도가 실제로 쓸모 있으려면 high일 때 정답률이 low일 때보다 높아야 한다.
const levels = ["high", "medium", "low"].map((level) => ({ level, rows: rows.filter((r) => r.confidence === level) })).filter((l) => l.rows.length > 0);
if (levels.length > 0) {
  console.log("확신도별");
  for (const l of levels) {
    console.log(`- ${l.level}: ${l.rows.length}문항, 버튼 ${percent(l.rows.filter((r) => r.buttonOk).length, l.rows.length)}, 위치 ${percent(l.rows.filter((r) => r.positionOk).length, l.rows.length)}`);
  }
  console.log();
}
if (stores.length > 1) {
  console.log("매장별");
  for (const s of stores) {
    console.log(`- ${s.store}: 버튼 ${percent(s.buttonCorrect, s.total)}, 위치 ${percent(s.positionCorrect, s.total)}, 평균 ${seconds(s.meanMs)} (${s.total}문항)`);
  }
  console.log();
}

const outDir = path.join("eval", "results");
await mkdir(outDir, { recursive: true });
const base = path.join(outDir, `${timestamp()}-${args.name}`);
const columns = ["id", "store", "source", "goal", "answerButton", "aiButton", "confidence", "buttonOk", "positionOk", "ms", "error", "aiMessage"];
const csv = [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n");
await writeFile(`${base}.csv`, "﻿" + csv, "utf8"); // BOM: 엑셀에서 한글이 깨지지 않게
await writeFile(
  `${base}.json`,
  JSON.stringify({ name: args.name, url: args.url, data: args.data, date: new Date().toISOString(), overall, stores }, null, 2),
  "utf8",
);
console.log(`저장: ${base}.csv, ${base}.json`);
