import { createContext, useContext, useEffect, useMemo, useState } from "react";
import en from "./en.json";
import hi from "./hi.json";

// All on-screen text lives in en.json / hi.json. Components only call t("key").
const STRINGS = { en, hi };
const I18nContext = createContext(null);

function startLang() {
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (fromUrl === "hi" || fromUrl === "en") return fromUrl;
  try {
    const saved = localStorage.getItem("sky-detective-lang");
    if (saved === "hi" || saved === "en") return saved;
  } catch {
    // storage blocked: fall back to English
  }
  return "en";
}

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(startLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem("sky-detective-lang", lang);
    } catch {
      // storage blocked: the choice lasts for this visit only
    }
  }, [lang]);

  const value = useMemo(() => {
    const strings = STRINGS[lang];
    const t = (key, vars = {}) => {
      const text = strings[key] ?? en[key] ?? key;
      return text.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? vars[name] : `{${name}}`));
    };
    const orbitClass = (name) => strings.orbitClass[name] ?? name;
    const toggle = () => setLang((l) => (l === "en" ? "hi" : "en"));
    return { lang, t, orbitClass, toggle };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
