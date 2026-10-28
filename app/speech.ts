"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { Lang } from "@/lib/guide";

// Web Speech API의 음성 인식은 TypeScript DOM 타입에 없어서 필요한 부분만 선언한다.
type RecognitionResultList = ArrayLike<ArrayLike<{ transcript: string }>>;
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const LOCALE: Record<Lang, string> = { ko: "ko-KR", en: "en-US" };

function getRecognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const noopSubscribe = () => () => {};

/** 말로 입력받기 (STT). 말하는 동안 중간 결과도 onText로 계속 넘겨준다. */
export function useSpeechRecognition(lang: Lang) {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => getRecognitionCtor() !== undefined,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);

  function start(onText: (text: string) => void, onEnd?: () => void) {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    stopSpeaking();
    recognition.current?.stop();
    const r = new Ctor();
    r.lang = LOCALE[lang];
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      onText(Array.from(e.results, (result) => result[0].transcript).join(""));
    };
    r.onend = () => {
      setListening(false);
      onEnd?.();
    };
    recognition.current = r;
    r.start();
    setListening(true);
  }

  function stop() {
    recognition.current?.stop();
  }

  return { supported, listening, start, stop };
}

/** 말로 안내하기 (TTS). 고령자를 위해 기본 속도를 조금 느리게 한다. */
export function speak(text: string, lang: Lang, rate = 0.9) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LOCALE[lang];
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
