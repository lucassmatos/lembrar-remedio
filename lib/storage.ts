"use client";

const KEY = {
  openai: "lr.openai.v1",
  openaiModel: "lr.openai.model.v1",
};

export const DEFAULT_OPENAI_MODEL = "gpt-5.4";

function emit(key: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("lr:change", { detail: { key } }));
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
  emit(key);
}

export function loadOpenAIKey(): string {
  return read<string>(KEY.openai, "");
}

export function saveOpenAIKey(key: string): void {
  if (typeof window === "undefined") return;
  const trimmed = key.trim();
  if (!trimmed) {
    localStorage.removeItem(KEY.openai);
    emit(KEY.openai);
    return;
  }
  write(KEY.openai, trimmed);
}

export function loadOpenAIModel(): string {
  const stored = read<string>(KEY.openaiModel, "");
  return stored.trim() || DEFAULT_OPENAI_MODEL;
}

export function saveOpenAIModel(model: string): void {
  if (typeof window === "undefined") return;
  const trimmed = model.trim();
  if (!trimmed || trimmed === DEFAULT_OPENAI_MODEL) {
    localStorage.removeItem(KEY.openaiModel);
    emit(KEY.openaiModel);
    return;
  }
  write(KEY.openaiModel, trimmed);
}
