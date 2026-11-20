import { useSyncExternalStore } from "react";
import { displayLabels } from "./labels";
import { bn } from "./bn";
export type Language = "bn" | "en";
const listeners = new Set<() => void>();
let language: Language = "bn";
try {
  if (localStorage.getItem("ems-language") === "en") language = "en";
} catch {
  /* Private browsing may disable storage. */
}
document.documentElement.lang = language;
export function setLanguage(value: Language) {
  language = value;
  document.documentElement.lang = value;
  try {
    localStorage.setItem("ems-language", value);
  } catch {
    /* Preference still works for this session. */
  }
  listeners.forEach((f) => f());
}
export function useLanguage() {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    () => language,
  );
}
export function tr(input: string | null | undefined): string {
  const value = input ?? "";
  if (language === "en") return displayLabels[value] ?? value;
  const trimmed = value.trim();
  const translated = bn[trimmed];
  return translated ? value.replace(trimmed, translated) : value;
}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
/** Formats a number for display: Bangla digits when the language is Bangla. */
export function num(input: number | string | null | undefined): string {
  const value = input === null || input === undefined ? "" : String(input);
  if (language !== "bn") return value;
  return value.replace(/\d/g, (digit) => BN_DIGITS[Number(digit)]);
}
/** Current language, for code that needs it outside a component. */
export function currentLanguage(): Language {
  return language;
}
