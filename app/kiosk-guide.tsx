"use client";

import { useEffect, useRef, useState } from "react";
import type { Guide, Lang } from "@/lib/guide";
import { captureFrame, fileToFrame, type Frame } from "./frame";
import { speak, stopSpeaking, useSpeechRecognition } from "./speech";

type Phase = "goal" | "camera" | "thinking" | "result";

const TEXT = {
  ko: {
    goalTitle: "무엇을 주문하고 싶으세요?",
    goalHint: "마이크를 누르고 말해 보세요. 예: 아이스 아메리카노 한 잔 포장",
    goalPlaceholder: "예: 아이스 아메리카노 한 잔 포장",
    micStart: "🎤 말하기",
    micStop: "■ 그만 듣기",
    micUnsupported: "이 브라우저는 음성 입력을 지원하지 않아요. 글자로 입력해 주세요.",
    start: "시작하기",
    pointCamera: "키오스크 화면이 테두리 안에 들어오게 비추고 찍기 버튼을 누르세요.",
    shoot: "📷 찍기",
    upload: "사진 고르기",
    cameraError: "카메라를 열 수 없어요. 사진 고르기를 눌러 주세요.",
    thinking: "화면을 보고 있어요. 잠시만 기다려 주세요.",
    pressHere: "여기를 누르세요",
    replay: "🔊 다시 듣기",
    pressed: "눌렀어요, 다음 화면",
    retake: "다시 찍기",
    nextShot: "잘하셨어요. 바뀐 화면을 다시 찍어 주세요.",
    done: "주문 완료!",
    restart: "처음으로",
    changeGoal: "목표 바꾸기",
    goal: "목표",
    failed: "안내를 받지 못했어요. 다시 찍어 주세요.",
  },
  en: {
    goalTitle: "What would you like to order?",
    goalHint: "Tap the mic and speak. e.g. One iced americano to go",
    goalPlaceholder: "e.g. One iced americano to go",
    micStart: "🎤 Speak",
    micStop: "■ Stop",
    micUnsupported: "Voice input isn't supported in this browser. Please type instead.",
    start: "Start",
    pointCamera: "Fit the kiosk screen inside the frame and tap the shoot button.",
    shoot: "📷 Shoot",
    upload: "Choose photo",
    cameraError: "Can't open the camera. Tap Choose photo instead.",
    thinking: "Looking at the screen. One moment, please.",
    pressHere: "Press here",
    replay: "🔊 Replay",
    pressed: "Done, next screen",
    retake: "Retake",
    nextShot: "Well done. Please take a photo of the new screen.",
    done: "Order complete!",
    restart: "Start over",
    changeGoal: "Change goal",
    goal: "Goal",
    failed: "Couldn't get guidance. Please take the photo again.",
  },
} satisfies Record<Lang, Record<string, string>>;

export function KioskGuide() {
  const [lang, setLang] = useState<Lang>("ko");
  const [phase, setPhase] = useState<Phase>("goal");
  const [goal, setGoal] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mic = useSpeechRecognition(lang);
  const t = TEXT[lang];

  const say = (text: string) => speak(text, lang);

  // 촬영 단계에서만 후면 카메라를 켜고, 벗어나면 끈다.
  useEffect(() => {
    if (phase !== "camera") return;
    let stream: MediaStream | undefined;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setCameraError(true));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [phase]);

  function goToCamera(announcement: string) {
    setCameraError(false);
    setGuide(null);
    setPhase("camera");
    say(announcement);
  }

  function toggleMic() {
    if (mic.listening) {
      mic.stop();
      return;
    }
    mic.start(setGoal);
  }

  async function ask(next: Frame) {
    setFrame(next);
    setError(null);
    setPhase("thinking");
    say(t.thinking);
    try {
      const res = await fetch("/api/guide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image: next.base64,
          width: next.width,
          height: next.height,
          goal,
          history,
          lang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t.failed);
      setGuide(data as Guide);
      setPhase("result");
      say((data as Guide).message);
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : t.failed;
      setError(message);
      setCameraError(false);
      setPhase("camera");
      say(message);
    }
  }

  function shoot() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    void ask(captureFrame(video));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void ask(await fileToFrame(file));
  }

  function pressed() {
    if (guide?.button) setHistory((h) => [...h, guide.button]);
    goToCamera(t.nextShot);
  }

  function restart() {
    stopSpeaking();
    setGoal("");
    setHistory([]);
    setFrame(null);
    setGuide(null);
    setError(null);
    setPhase("goal");
  }

  return (
    <div className="flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">키오스크 길잡이</h1>
        <div className="flex overflow-hidden rounded-full border border-zinc-300 text-sm dark:border-zinc-700">
          {(["ko", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`px-3 py-1.5 ${lang === l ? "bg-foreground text-background" : ""}`}
            >
              {l === "ko" ? "한국어" : "EN"}
            </button>
          ))}
        </div>
      </header>

      {phase !== "goal" && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-100 px-4 py-3 text-lg dark:bg-zinc-900">
          <span>
            <span className="text-zinc-500">{t.goal}: </span>
            {goal}
          </span>
          <button type="button" onClick={restart} className="shrink-0 text-base underline">
            {t.changeGoal}
          </button>
        </div>
      )}

      {phase === "goal" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-3xl font-bold leading-tight">{t.goalTitle}</h2>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            {mic.supported ? t.goalHint : t.micUnsupported}
          </p>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t.goalPlaceholder}
            rows={2}
            maxLength={200}
            className="rounded-xl border-2 border-zinc-300 bg-transparent p-4 text-2xl dark:border-zinc-700"
          />
          {mic.supported && (
            <button
              type="button"
              onClick={toggleMic}
              className={`h-20 rounded-2xl text-2xl font-bold text-white ${
                mic.listening ? "animate-pulse bg-red-600" : "bg-blue-600"
              }`}
            >
              {mic.listening ? t.micStop : t.micStart}
            </button>
          )}
          <button
            type="button"
            disabled={goal.trim() === ""}
            onClick={() => {
              mic.stop();
              goToCamera(t.pointCamera);
            }}
            className="h-16 rounded-2xl bg-foreground text-2xl font-bold text-background disabled:opacity-30"
          >
            {t.start}
          </button>
        </section>
      )}

      {phase === "camera" && (
        <section className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="rounded-xl bg-red-100 p-4 text-lg text-red-800 dark:bg-red-950 dark:text-red-200">
              {error}
            </p>
          )}
          <p className="text-lg">{cameraError ? t.cameraError : t.pointCamera}</p>
          {!cameraError && (
            <div className="relative overflow-hidden rounded-2xl bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="block w-full" />
              <div className="pointer-events-none absolute inset-4 rounded-xl border-4 border-dashed border-white/80" />
            </div>
          )}
          <div className="flex gap-3">
            {!cameraError && (
              <button
                type="button"
                onClick={shoot}
                className="h-20 flex-1 rounded-2xl bg-blue-600 text-2xl font-bold text-white"
              >
                {t.shoot}
              </button>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={`h-20 rounded-2xl border-2 border-zinc-300 px-4 text-lg font-bold dark:border-zinc-700 ${
                cameraError ? "flex-1" : ""
              }`}
            >
              {t.upload}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
          </div>
        </section>
      )}

      {(phase === "thinking" || phase === "result") && frame && (
        <section className="flex flex-col gap-4">
          <div className="relative overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- 방금 찍은 data URL 사진이라 next/image 최적화 대상이 아니다 */}
            <img src={frame.dataUrl} alt="찍은 키오스크 화면" className="block w-full" />
            {phase === "thinking" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-bold text-white">
                <span className="animate-pulse">{t.thinking}</span>
              </div>
            )}
            {phase === "result" && guide?.box && <PressHere box={guide.box} label={t.pressHere} />}
          </div>

          {phase === "result" && guide && (
            <>
              {guide.done && <p className="text-center text-3xl font-bold text-green-600">{t.done}</p>}
              <p className="rounded-2xl bg-yellow-100 p-5 text-2xl font-bold leading-snug text-zinc-900">
                {guide.message}
              </p>
              {guide.stage && (
                <p className="text-base text-zinc-500">
                  {guide.stage}
                  {history.length > 0 && ` · ${history.join(" → ")}`}
                </p>
              )}
              <button
                type="button"
                onClick={() => say(guide.message)}
                className="h-14 rounded-2xl border-2 border-zinc-300 text-xl font-bold dark:border-zinc-700"
              >
                {t.replay}
              </button>
              {guide.done ? (
                <button
                  type="button"
                  onClick={restart}
                  className="h-20 rounded-2xl bg-foreground text-2xl font-bold text-background"
                >
                  {t.restart}
                </button>
              ) : (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={pressed}
                    className="h-20 flex-[2] rounded-2xl bg-blue-600 text-xl font-bold text-white"
                  >
                    {t.pressed}
                  </button>
                  <button
                    type="button"
                    onClick={() => goToCamera(t.pointCamera)}
                    className="h-20 flex-1 rounded-2xl border-2 border-zinc-300 text-xl font-bold dark:border-zinc-700"
                  >
                    {t.retake}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** 사진 위에 눌러야 할 버튼을 빨간 상자로 표시한다. 좌표가 비율이라 사진 크기가 바뀌어도 맞는다. */
function PressHere({ box, label }: { box: NonNullable<Guide["box"]>; label: string }) {
  const labelBelow = box.top < 0.12;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${box.left * 100}%`,
        top: `${box.top * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
      }}
    >
      <div className="absolute -inset-1 animate-ping rounded-lg border-4 border-red-500 opacity-60" />
      <div className="absolute -inset-1 rounded-lg border-4 border-red-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      <span
        className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-red-600 px-3 py-1 text-base font-bold text-white ${
          labelBelow ? "top-full mt-2" : "bottom-full mb-2"
        }`}
      >
        {labelBelow ? "▲" : "▼"} {label}
      </span>
    </div>
  );
}
