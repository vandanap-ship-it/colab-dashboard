"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";

/**
 * Textarea (or single-line input) with a mic button that uses the Web Speech
 * API to dictate. Appends transcribed text to whatever's already in the field.
 *
 * Falls back silently to a plain textarea on browsers without
 * SpeechRecognition (e.g. Firefox). Works natively on iOS Safari, Chrome,
 * Edge.
 */

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  className?: string;
  multiline?: boolean;
  lang?: string;
};

// SpeechRecognition isn't in TS's default DOM types — declare what we use.
type RecognitionEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
  resultIndex: number;
};
type Recognition = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionConstructor = new () => Recognition;

function getRecognitionCtor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function VoiceTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  required,
  className = "",
  multiline = true,
  lang = "en-IN",
}: Props) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);
  // Keep the latest value in a ref so the async speech-recognition callback can
  // append to the current text. Updated in an effect (after commit) rather than
  // during render — the callback only fires well after render, so it always
  // sees the latest committed value.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    // Client-only feature detection: SpeechRecognition is undefined during
    // SSR, so we default `supported` to false and flip it after hydration.
    // This is exactly the "sync with external system" use case setState-in-
    // effect is for; the lint rule can't tell.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(getRecognitionCtor() !== null);
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = lang;
    rec.onresult = (e) => {
      let chunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        chunk += e.results[i][0].transcript;
      }
      chunk = chunk.trim();
      if (!chunk) return;
      const base = valueRef.current;
      const sep = base && !base.endsWith(" ") && !base.endsWith("\n") ? " " : "";
      onChange(base + sep + chunk);
    };
    rec.onerror = () => {
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [lang, onChange]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const toggle = () => {
    if (listening) stop();
    else start();
  };

  // Field padding leaves room for the mic pill at the bottom-right on
  // multiline (an obvious CTA under the writing area), or the classic
  // right-side round mic on single-line inputs where a pill wouldn't fit.
  const sharedFieldClasses = multiline
    ? "w-full rounded-lg border border-stone-300 bg-white px-3 pt-3 pb-14 text-base"
    : "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base pr-14";

  return (
    <div className="relative">
      {multiline ? (
        <textarea
          required={required}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${sharedFieldClasses} ${className}`}
        />
      ) : (
        <input
          type="text"
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${sharedFieldClasses} ${className}`}
        />
      )}

      {supported && multiline && (
        // Big pill — the primary way into this field. Reads "Tap to speak"
        // when idle and "Listening…" when recording (with a red pulsing
        // background), so a site engineer who doesn't want to type sees
        // the way in immediately. Sits inside the field at bottom-right so
        // it doesn't fight the label above.
        <button
          type="button"
          onClick={toggle}
          aria-label={listening ? "Stop dictation" : "Start dictation"}
          className={`absolute right-2 bottom-2 inline-flex items-center gap-2 rounded-full px-4 h-11 text-[14px] font-semibold shadow-sm transition-colors active:scale-[0.98] ${
            listening
              ? "bg-ferrous-500 text-white animate-pulse"
              : "bg-stone-900 text-white hover:bg-stone-800"
          }`}
        >
          <Mic className="w-4 h-4" />
          {listening ? "Listening…" : "Tap to speak"}
        </button>
      )}
      {supported && !multiline && (
        // Compact round mic on single-line inputs (Reason detail etc.) —
        // pill would break the layout.
        <button
          type="button"
          onClick={toggle}
          aria-label={listening ? "Stop dictation" : "Start dictation"}
          className={`absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
            listening
              ? "bg-ferrous-500 text-white animate-pulse"
              : "bg-stone-100 text-stone-700 hover:bg-stone-200"
          }`}
        >
          <Mic className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
