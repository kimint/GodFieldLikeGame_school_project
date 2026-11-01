import type { ReactElement } from "react";
import { findClassById } from "../model/catalog.ts";
import { RECENT_LIMIT, type HistoryEntry, type MatchHistoryData } from "../online/historyApi.ts";

const RESULT_LABEL: Record<HistoryEntry["result"], string> = { win: "W", draw: "D", loss: "L" };

function className(classId: string): string {
  try {
    return findClassById(classId).name;
  } catch {
    return classId; // a class that has since been removed from the catalog
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export interface MatchHistoryProps {
  username: string;
  history: MatchHistoryData | null; // null while loading
  error: string | null;
  onBack: () => void;
}

/** "My record" screen (React shell): all-time PvP record and the last few PvP games. Loaded by App. */
export function MatchHistory({ username, history, error, onBack }: MatchHistoryProps): ReactElement {
  return (
    <div className="shell-screen">
      <div className="shell-topbar">
        <span className="shell-title">My Record</span>
        <button type="button" className="shell-button" onClick={onBack}>
          ← Back
        </button>
      </div>
      <p className="shell-subtitle">{username} · Random matches only</p>
      {error ? (
        <p className="shell-note">Couldn&apos;t load your match history: {error}</p>
      ) : (
        <HistoryPanel history={history} />
      )}
    </div>
  );
}

function HistoryPanel({ history }: { history: MatchHistoryData | null }): ReactElement {
  const record = history?.record ?? null;
  const total = record ? record.wins + record.draws + record.losses : 0;
  const winRate = record && total > 0 ? Math.round((record.wins / total) * 1000) / 10 : null;
  const games = history?.recent ?? null;

  return (
    <section className="history-panel">
      <div className="history-record">
        <span className="history-record-label">PvP record</span>
        {record ? (
          <>
            <span className="history-count win">{record.wins}W</span>
            <span className="history-count draw">{record.draws}D</span>
            <span className="history-count loss">{record.losses}L</span>
            <span className="history-rate">
              {winRate === null ? "No games yet" : `${winRate}% win rate · ${total} games`}
            </span>
          </>
        ) : (
          <span className="history-rate">Loading…</span>
        )}
      </div>
      <div className="history-recent">
        <span className="history-record-label">Last {RECENT_LIMIT} PvP games</span>
        {games === null ? (
          <p className="history-empty">Loading…</p>
        ) : games.length === 0 ? (
          <p className="history-empty">No PvP games yet.</p>
        ) : (
          <ul className="history-list">
            {games.map((g) => (
              <li key={g.id} className="history-row">
                <span className={`history-result ${g.result}`}>{RESULT_LABEL[g.result]}</span>
                <span className="history-matchup">
                  {className(g.myClass)} <span className="history-vs">vs</span> {className(g.opponentClass)}
                  <span className="history-opponent"> · {g.opponentName}</span>
                </span>
                <span className="history-meta">
                  {g.rounds} rounds · {when(g.finishedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
