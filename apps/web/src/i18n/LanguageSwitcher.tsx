import { setLanguage, useLanguage } from "./language";

export default function LanguageSwitcher() {
  const language = useLanguage();
  return (
    <div
      className="language-switcher"
      role="group"
      aria-label="Language / ভাষা"
    >
      <button
        type="button"
        lang="bn"
        aria-pressed={language === "bn"}
        onClick={() => setLanguage("bn")}
      >
        বাংলা
      </button>
      <button
        type="button"
        lang="en"
        aria-pressed={language === "en"}
        onClick={() => setLanguage("en")}
      >
        English
      </button>
    </div>
  );
}
