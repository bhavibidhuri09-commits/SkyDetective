// Scoring rules from the team plan.
export const TAP_RADIUS_PX = 12; // image pixels: 37″ at 3.08″ per pixel
export const FIND_POINTS = 100;
export const NOTHING_MOVED_POINTS = 150;
export const MISS_POINTS = -25;
const SPEED_BONUS_MAX = 50;
const SPEED_BONUS_SECONDS = 20;
const STREAK_NEEDED = 3;

export function targetAt(targets, foundIds, x, y) {
  return targets.find(
    (t) => !foundIds.includes(t.id) && t.frames.some((f) => Math.hypot(f.x - x, f.y - y) <= TAP_RADIUS_PX)
  );
}

// streak = correct answers in a row before this one
export function correctPoints(base, seconds, streak, withSpeedBonus = true) {
  const bonus = withSpeedBonus
    ? Math.max(0, Math.round(SPEED_BONUS_MAX * (1 - seconds / SPEED_BONUS_SECONDS)))
    : 0;
  const onStreak = streak >= STREAK_NEEDED;
  return { points: Math.round((base + bonus) * (onStreak ? 1.5 : 1)), bonus, onStreak };
}

export const emptyStats = () => ({
  score: 0, correct: 0, answers: 0, moversFound: 0, skyDeg2: 0, streak: 0, realRounds: 0, simRounds: 0,
});
