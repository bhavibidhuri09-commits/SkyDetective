import { useEffect, useState } from "react";
import { useI18n } from "./i18n/I18n.jsx";
import { buildChallengeRounds, loadRoundList } from "./game/levels.js";
import Home from "./components/Home.jsx";
import Game from "./components/Game.jsx";
import EndCard from "./components/EndCard.jsx";
import Explorer from "./components/Explorer.jsx";

// A link like ?ra=133.795&dec=-7.245&fov=0.25&det=6 opens the explorer on that patch of sky.
function linkedSky() {
  const q = new URLSearchParams(window.location.search);
  if (!q.get("ra") || !q.get("dec")) return null;
  return { ra: q.get("ra"), dec: q.get("dec"), fov: Number(q.get("fov")), det: Number(q.get("det")) };
}

export default function App() {
  const { t, toggle } = useI18n();
  const [rounds, setRounds] = useState(null);
  const [linked] = useState(linkedSky);
  const [screen, setScreen] = useState(linked ? "explore" : "home"); // home | explore | case | challenge | practice | end
  const [playMode, setPlayMode] = useState("case");
  const [playRounds, setPlayRounds] = useState(null);
  const [finalStats, setFinalStats] = useState(null);
  const [gameKey, setGameKey] = useState(0);

  useEffect(() => {
    loadRoundList().then(setRounds).catch(() => setRounds([]));
  }, []);

  const start = (mode) => {
    setGameKey((k) => k + 1);
    setPlayMode(mode);
    setPlayRounds(mode === "challenge" ? buildChallengeRounds(rounds) : rounds);
    setScreen(mode);
  };

  const goHome = () => {
    window.history.replaceState(null, "", window.location.pathname);
    setScreen("home");
  };

  return (
    <div className="wrap">
      <header>
        <button className="brand" type="button" onClick={goHome}>
          <h1>Sky <span>Detective</span></h1>
          <p>{t("tag")}</p>
        </button>
        <button className="lang" type="button" onClick={toggle}>{t("switchLang")}</button>
      </header>

      {screen === "home" && (
        <Home
          ready={Boolean(rounds?.length)}
          onStart={() => start("case")}
          onChallenge={() => start("challenge")}
          onPractice={() => start("practice")}
          onExplore={() => setScreen("explore")}
        />
      )}
      {screen === "explore" && <Explorer initial={linked} onHome={goHome} />}
      {(screen === "case" || screen === "challenge" || screen === "practice") && (
        <Game
          key={gameKey}
          mode={screen}
          rounds={playRounds}
          onHome={() => setScreen("home")}
          onEnd={(stats) => { setFinalStats(stats); setScreen("end"); }}
        />
      )}
      {screen === "end" && (
        <EndCard stats={finalStats} mode={playMode} onAgain={() => start(playMode)} onHome={() => setScreen("home")} />
      )}

      <footer className="credit">{t("credit")}</footer>
    </div>
  );
}
