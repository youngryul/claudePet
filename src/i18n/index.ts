import { useEffect } from "react";
import { useSettings } from "@/stores/settingsStore";
import { en, type Dict } from "./en";
import { ko } from "./ko";

export type Lang = "ko" | "en";
export type { Dict };

export const LANGUAGES: { id: Lang; name: string }[] = [
  { id: "ko", name: "한국어" },
  { id: "en", name: "English" },
];

const DICTS: Record<Lang, Dict> = { ko, en };

export const dictFor = (lang: string): Dict => DICTS[lang as Lang] ?? ko;

/** Current dictionary, for non-React helpers (formatters). Components should use `useT`. */
export const currentDict = (): Dict => dictFor(useSettings.getState().settings.display.language);

/** Current dictionary; re-renders the component when the language changes. */
export function useT(): Dict {
  return dictFor(useSettings((s) => s.settings.display.language));
}

/** Keep `<html lang>` in sync with the chosen language. */
export function useDocumentLang() {
  const lang = useSettings((s) => s.settings.display.language);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
}
