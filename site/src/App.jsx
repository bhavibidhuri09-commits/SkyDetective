import { useEffect, useState } from "react";
import { useI18n } from "./i18n/I18n.jsx";
import { loadRoundList } from "./game/levels.js";
import Home from "./components/Home.jsx";
import Game from "./components/Game.jsx";
import EndCard from "./components/EndCard.jsx";

export default function App() {
  const { t, toggle } = useI18n();
  const [rounds, setRounds] = useState(null);
  const [screen, setScreen] = useState("home"); // home | case | practice | end
  const [finalStats, setFinalStats] = useState(null);
  const [gameKey, setGameKey] = useState(0);

  useEffect(() => {
    loadRoundList().then(setRounds).catch(() => setRounds([]));
  }, []);

  const start = (mode) => {
    setGameKey((k) => k + 1);
    setScreen(mode);
  };

  return (
    <div className="wrap">
      <header>
        <button className="brand" type="button" onClick={() => setScreen("home")}>
          <h1>Sky <span>Detective</span></h1>
          <p>{t("tag")}</p>
        </button>
        <button className="lang" type="button" onClick={toggle}>{t("switchLang")}</button>
      </header>

      {screen === "home" && (
        <Home ready={Boolean(rounds?.length)} onStart={() => start("case")} onPractice={() => start("practice")} />
      )}
      {(screen === "case" || screen === "practice") && (
        <Game
          key={gameKey}
          mode={screen}
          rounds={rounds}
          onHome={() => setScreen("home")}
          onEnd={(stats) => { setFinalStats(stats); setScreen("end"); }}
        />
      )}
      {screen === "end" && (
        <EndCard stats={finalStats} onAgain={() => start("case")} onHome={() => setScreen("home")} />
      )}

      <footer className="credit">{t("credit")}</footer>
    </div>
  );
}
