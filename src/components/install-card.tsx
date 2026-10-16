import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { useInstallPrompt } from "@/components/pwa-effect";
import { browserStorage, readDeviceValue, writeDeviceValue } from "@/lib/device-storage";
import { INSTALL_DISMISSED_KEY, installMode, type InstallMode } from "@/lib/install-mode";

/** Lobby card: Android gets an install button, iPhone a large three-step guide. Dismissal sticks. */
export function InstallCard() {
  const prompt = useInstallPrompt((state) => state.prompt);
  const clearPrompt = useInstallPrompt((state) => state.set);
  const [mode, setMode] = useState<InstallMode>("none");
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setMode(installMode({ userAgent: navigator.userAgent, hasPrompt: Boolean(prompt), standalone }));
    setDismissed(readDeviceValue(browserStorage(), INSTALL_DISMISSED_KEY) === "dismissed");
  }, [prompt]);
  if (mode === "none" || dismissed) return null;
  function dismiss() {
    writeDeviceValue(browserStorage(), INSTALL_DISMISSED_KEY, "dismissed");
    setDismissed(true);
  }
  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice.catch(() => undefined);
    clearPrompt(null);
  }
  return (
    <section className="install-card" aria-labelledby="install-title">
      <h2 id="install-title">
        <Smartphone aria-hidden size={22} />
        加到主畫面，下次一點就開
      </h2>
      {mode === "android-prompt" ? (
        <>
          <p>安裝後會像 App 一樣出現在手機桌面。</p>
          <button type="button" className="academy-button-primary install-primary" onClick={() => void install()}>
            安裝
          </button>
        </>
      ) : mode === "ios-open-safari" ? (
        <p>
          現在是在 LINE 或 Facebook 裡面打開，無法加到主畫面。請點畫面上的選單（⋯
          或分享），選「用 Safari 開啟」，再照步驟加到主畫面。
        </p>
      ) : (
        <ol>
          <li>點畫面下方的「分享」按鈕（方框加向上箭頭）</li>
          <li>往下滑，選「加入主畫面」</li>
          <li>點右上角的「新增」</li>
        </ol>
      )}
      <button type="button" className="install-dismiss" onClick={dismiss}>
        不用了
      </button>
    </section>
  );
}
