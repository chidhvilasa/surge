import type { SurgeStats } from "@/lib/surge/stats";

export function StatsReadout({ stats }: { stats: SurgeStats }) {
  const streakLabel =
    stats.currentStreak.type === null
      ? "no streak yet"
      : `${stats.currentStreak.count}-${stats.currentStreak.type} streak`;

  return (
    <div
      className="w-full px-4 py-1.5 flex items-center justify-between gap-4 rounded-sm"
      style={{
        fontFamily: "var(--font-mono-display)",
        fontSize: 10,
        letterSpacing: "0.06em",
        color: "rgba(255,255,255,0.4)",
      }}
    >
      <span>{streakLabel}</span>
      <span>
        games {stats.gamesPlayed} &middot; you {stats.humanWins} &middot; agent{" "}
        {stats.agentWins}
      </span>
    </div>
  );
}
