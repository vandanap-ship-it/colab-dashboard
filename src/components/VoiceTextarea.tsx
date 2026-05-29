"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

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

  const sharedFieldClasses =
    "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm pr-11";

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

      {supported && (
        <button
          type="button"
          onClick={toggle}
          aria-label={listening ? "Stop dictation" : "Start dictation"}
          title={listening ? "Stop dictation" : "Tap to dictate"}
          className={`absolute right-2 ${
            multiline ? "bottom-2" : "top-1/2 -translate-y-1/2"
          } w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
            listening
              ? "bg-red-500 text-white animate-pulse"
              : "bg-stone-100 text-stone-600 hover:bg-stone-200"
          }`}
        >
          {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}
