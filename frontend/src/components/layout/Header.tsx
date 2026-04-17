import { useState, useEffect } from "react";
import { useLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import { api } from "@/api/client";

export function Header() {
  const [locale, setLocale] = useLocale();
  const [version, setVersion] = useState("");

  useEffect(() => {
    api.getVersion().then((r) => setVersion(r.version)).catch(() => {});
  }, []);

  return (
    <header className="bg-dark-800 border-b border-dark-600 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => window.location.reload()}>
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 shrink-0 fill-white">
            <path d="M11.979 0C5.678 0 0.511 4.86 0.022 11.037l6.432 2.658c0.545 -0.371 1.203 -0.59 1.912 -0.59 0.063 0 0.125 0.004 0.188 0.006l2.861 -4.142V8.91c0 -2.495 2.028 -4.524 4.524 -4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525 -4.524 4.525h-0.105l-4.076 2.911c0 0.052 0.004 0.105 0.004 0.159 0 1.875 -1.515 3.396 -3.39 3.396 -1.635 0 -3.016 -1.173 -3.331 -2.727L0.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999 -5.373 11.999 -12S18.605 0 11.979 0zM7.54 18.21l-1.473 -0.61c0.262 0.543 0.714 0.999 1.314 1.25 1.297 0.539 2.793 -0.076 3.332 -1.375 0.263 -0.63 0.264 -1.319 0.005 -1.949s-0.75 -1.121 -1.377 -1.383c-0.624 -0.26 -1.29 -0.249 -1.878 -0.03l1.523 0.63c0.956 0.4 1.409 1.5 1.009 2.455 -0.397 0.957 -1.497 1.41 -2.454 1.012H7.54zm11.415 -9.303c0 -1.662 -1.353 -3.015 -3.015 -3.015 -1.665 0 -3.015 1.353 -3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015 -1.35 3.015 -3.015zm-5.273 -0.005c0 -1.252 1.013 -2.266 2.265 -2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251 -1.017 2.265 -2.266 2.265 -1.253 0 -2.265 -1.014 -2.265 -2.265z"/>
          </svg>
          <h1 className="text-lg font-bold text-white tracking-wide">SteamPanel</h1>
        </div>
        <span className="text-xs text-gray-500">{version && `v${version}`}</span>
        <span className="text-xs text-gray-500">by{" "}
          <a
            href="https://t.me/lolzdm"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-accent transition"
          >
            @lolzdm
          </a>
        </span>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={() => setLocale(locale === "ru" ? "en" : "ru" as Locale)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition px-2 py-1 border border-dark-500 hover:border-gray-500 rounded"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          {locale === "ru" ? "EN" : "RU"}
        </button>
      </div>
    </header>
  );
}
