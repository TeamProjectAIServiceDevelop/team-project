const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5vl:7b";

/** AI 서버 호출이 실패했을 때. status는 웹 API가 그대로 돌려줄 HTTP 상태 코드다. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Ollama에 대화를 보내고, format 스키마에 맞춘 모델 출력(JSON 문자열)을 받는다. */
export async function chat(messages: unknown[], format: object): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format,
        options: { temperature: 0 },
        messages,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new AiError("AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", 503);
  }
  if (!res.ok) throw new AiError(`AI 서버 오류 (${res.status})`, 502);

  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}
