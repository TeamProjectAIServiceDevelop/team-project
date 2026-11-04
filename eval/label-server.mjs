// 라벨링 도구 서버: 사진에 정답 버튼 상자를 그려 labels.jsonl을 만든다. 사용법은 eval/README.md 참고.
// 의존성 없이 Node 기본 모듈만 쓴다. 내 컴퓨터(127.0.0.1)에서만 열린다.
import { createServer } from "node:http";
import { appendFile, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: { data: { type: "string" }, port: { type: "string", default: "4173" } },
});

if (!args.data) {
  console.error("데이터 폴더를 지정해 주세요. 예: npm run label -- --data eval/data/1차");
  process.exit(1);
}

const dataDir = path.resolve(args.data);
const imageDir = path.join(dataDir, "images");
const labelFile = path.join(dataDir, "labels.jsonl");
const pageFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "label", "index.html");
const IMAGE_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

try {
  await stat(imageDir);
} catch {
  console.error(`${imageDir} 폴더가 없어요. 사진을 이 폴더에 넣어 주세요.`);
  process.exit(1);
}

async function listImages() {
  const names = await readdir(imageDir);
  return names
    .filter((n) => path.extname(n).toLowerCase() in IMAGE_TYPES)
    .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}

async function readLabels() {
  let text = "";
  try {
    // 메모장·PowerShell이 붙이는 BOM은 떼어 낸다.
    text = (await readFile(labelFile, "utf8")).replace(/^﻿/, "");
  } catch {
    return [];
  }
  return text.split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

/** run-eval.mjs의 읽기 규칙과 같은 기준으로 문항을 검사한다. 문제가 있으면 이유를 돌려준다. */
function validate(item) {
  const missing = ["id", "image", "store", "source", "goal"].filter((k) => typeof item[k] !== "string" || item[k].trim() === "");
  if (typeof item.answer?.button !== "string" || item.answer.button.trim() === "") missing.push("answer.button");
  const box = item.answer?.box;
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) missing.push("answer.box");
  if (missing.length > 0) return `${missing.join(", ")} 확인 필요`;
  if (!["photo", "video"].includes(item.source)) return "source는 photo 또는 video";
  if (item.image.includes("..")) return "image 경로가 올바르지 않아요";
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) reject(new Error("too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(await readFile(pageFile));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, { dataName: path.basename(dataDir), images: await listImages(), labels: await readLabels() });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/img/")) {
      const name = decodeURIComponent(url.pathname.slice(5));
      const type = IMAGE_TYPES[path.extname(name).toLowerCase()];
      // 폴더 밖 파일을 읽지 못하게, images 폴더 안의 파일 이름만 허용한다.
      if (!type || name !== path.basename(name)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": type });
      res.end(await readFile(path.join(imageDir, name)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/label") {
      const item = JSON.parse(await readBody(req));
      const problem = validate(item);
      if (problem) return sendJson(res, 400, { error: problem });
      const labels = await readLabels();
      if (labels.some((l) => l.id === item.id)) return sendJson(res, 409, { error: `id가 겹쳐요: ${item.id}` });
      // BOM 없는 UTF-8, 한 줄에 JSON 하나
      await appendFile(labelFile, JSON.stringify(item) + "\n", "utf8");
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/delete") {
      const { id } = JSON.parse(await readBody(req));
      const labels = await readLabels();
      const kept = labels.filter((l) => l.id !== id);
      await writeFile(labelFile, kept.map((l) => JSON.stringify(l)).join("\n") + (kept.length ? "\n" : ""), "utf8");
      return sendJson(res, 200, { ok: true, removed: labels.length - kept.length });
    }

    res.writeHead(404).end();
  } catch (error) {
    sendJson(res, 500, { error: String(error.message ?? error) });
  }
});

server.listen(Number(args.port), "127.0.0.1", () => {
  console.log(`라벨링 도구: http://localhost:${args.port}`);
  console.log(`사진 폴더: ${imageDir}`);
  console.log(`저장 파일: ${labelFile}`);
  console.log("끝내려면 Ctrl+C");
});
