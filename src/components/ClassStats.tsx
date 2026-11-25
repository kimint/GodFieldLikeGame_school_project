import { useEffect, useState, type ReactElement } from "react";
import { allClasses } from "../model/catalog.ts";
import { fetchClassWinRates, type ClassWinRate, type WinRateMode } from "../online/historyApi.ts";

type ModeFilter = WinRateMode | "all";

const MODE_LABEL: Record<ModeFilter, string> = { pvp: "PvP", cpu: "vs CPU", all: "Combined" };

interface Tally {
  wins: number;
  draws: number;
  losses: number;
  games: number;
  winRate: number | null; // percent, draws counting half
}

// One class's numbers for a mode ("all" adds PvP and vs-CPU together).
function tally(rates: ClassWinRate[], classId: string, mode: ModeFilter): Tally {
  const rows = rates.filter((r) => r.classId === classId && (mode === "all" || r.mode === mode));
  const wins = rows.reduce((s, r) => s + r.wins, 0);
  const draws = rows.reduce((s, r) => s + r.draws, 0);
  const losses = rows.reduce((s, r) => s + r.losses, 0);
  const games = wins + draws + losses;
  const winRate = games > 0 ? Math.round(((wins + draws / 2) / games) * 1000) / 10 : null;
  return { wins, draws, losses, games, winRate };
}

/**
 * Compact per-class table (PvP and vs CPU columns), used on "My record" for
 * the player's own classes. `rates` undefined = loading, null = couldn't load.
 */
export function ClassRateTable({ title, rates }: { title: string; rates: ClassWinRate[] | null | undefined }): ReactElement {
  const cell = (classId: string, mode: WinRateMode): ReactElement => {
    const t = rates ? tally(rates, classId, mode) : null;
    if (!t || t.winRate === null) return <td className="class-rate-empty">–</td>;
    return (
      <td>
        <strong>{t.winRate}%</strong> <span className="class-rate-games">{t.games} games</span>
      </td>
    );
  };
  return (
    <div className="record-card class-rates">
      <h2 className="record-card-head">{title}</h2>
      {rates === undefined ? (
        <p className="history-empty">Loading…</p>
      ) : rates === null ? (
        <p className="history-empty">Class stats aren&apos;t available yet.</p>
      ) : (
        <table className="class-rate-table">
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col">PvP</th>
              <th scope="col">vs CPU</th>
            </tr>
          </thead>
          <tbody>
            {allClasses().map((c) => (
              <tr key={c.id}>
                <th scope="row">{c.name}</th>
                {cell(c.id, "pvp")}
                {cell(c.id, "cpu")}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export interface ClassStatsProps {
  onBack: () => void;
}

/** "Class stats" screen (React shell): every class's all-time win rate, from every player's games. */
export function ClassStats({ onBack }: ClassStatsProps): ReactElement {
  const [rates, setRates] = useState<ClassWinRate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeFilter>("pvp");

  useEffect(() => {
    let live = true;
    fetchClassWinRates("all")
      .then((r) => live && setRates(r))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  const rows = rates
    ? allClasses()
        .map((c) => ({ classDef: c, t: tally(rates, c.id, mode) }))
        .sort((a, b) => (b.t.winRate ?? -1) - (a.t.winRate ?? -1))
    : [];
  const totalGames = rows.reduce((s, r) => s + r.t.games, 0);

  return (
    <div className="shell-screen record-screen">
      <header className="record-header">
        <div className="record-heading">
          <h1 className="record-title">Class Stats</h1>
          <p className="record-subtitle">
            <span>All players</span>
            <span className="record-sep" aria-hidden="true" />
            <span>All-time · draws count half</span>
          </p>
        </div>
        <button type="button" className="record-back" onClick={onBack}>
          ← Back
        </button>
      </header>

      <div className="class-stats-modes" role="radiogroup" aria-label="Game mode">
        {(Object.keys(MODE_LABEL) as ModeFilter[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={`lobby-deck${mode === m ? " selected" : ""}`}
            onClick={() => setMode(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <section className="record-card class-stats">
        {error ? (
          <p className="history-empty">Couldn&apos;t load class stats: {error}</p>
        ) : rates === null ? (
          <p className="history-empty">Loading…</p>
        ) : (
          <>
            <ul className="class-stats-list">
              {rows.map(({ classDef, t }) => (
                <li key={classDef.id} className="class-stats-row">
                  <span className="class-stats-name">{classDef.name}</span>
                  <span className="class-stats-bar" aria-hidden="true">
                    <span className="class-stats-fill" style={{ width: `${t.winRate ?? 0}%` }} />
                    <span className="class-stats-even" />
                  </span>
                  <span className="class-stats-rate">{t.winRate === null ? "–" : `${t.winRate}%`}</span>
                  <span className="class-stats-wdl">
                    {t.wins}W · {t.draws}D · {t.losses}L
                  </span>
                </li>
              ))}
            </ul>
            <p className="history-rate class-stats-total">
              {totalGames === 0
                ? `No ${MODE_LABEL[mode]} games recorded yet.`
                : `${totalGames} class results (${MODE_LABEL[mode]}). In PvP each game counts once for each side; the line marks 50%.`}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
