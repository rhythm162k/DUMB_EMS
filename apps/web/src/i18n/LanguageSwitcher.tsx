import { setLanguage, useLanguage } from "./language";

/** Compact বাংলা / EN toggle. `floating` pins it top-right (used on sign-in screens). */
export default function LanguageSwitcher({
  floating = false,
}: {
  floating?: boolean;
}) {
  const language = useLanguage();
  return (
    <div
      className={`language-switcher${floating ? " language-switcher--floating" : ""}`}
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
