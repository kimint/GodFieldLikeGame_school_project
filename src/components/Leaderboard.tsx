import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type Ref } from "react";
import { classIconMarkup } from "../icons.ts";
import { findClassById } from "../model/catalog.ts";
import { REWARDS } from "../model/shop.ts";
import {
  fetchLeaderboard,
  LEADERBOARD_SIZE,
  type LeaderboardCategory,
  type LeaderboardData,
  type LeaderboardEntry,
} from "../online/leaderboardApi.ts";
import { PlayerAvatar } from "./PlayerAvatar.tsx";

const CATEGORIES: { id: LeaderboardCategory; label: string; icon: string }[] = [
  { id: "wins", label: "Most Wins", icon: "🏆" },
  { id: "gold", label: "Total Gold Earned", icon: "💰" },
];

const RANK_UP_MS = 2600;

// Same accents as the lobby's class rail (ClassSelect.tsx).
const CLASS_ACCENT: Record<string, string> = {
  guardian: "#8fb3e0",
  pyromancer: "#ff9a3c",
  black_mage: "#b892ff",
  craftsman: "#d79a5b",
  necromancer: "#4fd1a0",
};

const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");
const games = (e: LeaderboardEntry): number => e.wins + e.draws + e.losses;
const winRate = (e: LeaderboardEntry): number => (games(e) === 0 ? 0 : (e.wins / games(e)) * 100);
const scoreOf = (e: LeaderboardEntry, category: LeaderboardCategory): number => (category === "wins" ? e.wins : e.earned);

function className(classId: string): string {
  try {
    return findClassById(classId).name;
  } catch {
    return classId;
  }
}

// The last rank this account saw per category, so opening the leaderboard
// after a few wins can show "▲ +N Ranks". Browser storage only; a missing or
// blocked store just means no animation.
const seenKey = (accountId: string, category: LeaderboardCategory): string => `zenkake.leaderboard.${accountId}.${category}`;
function readSeenRank(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeSeenRank(key: string, rank: number): void {
  try {
    localStorage.setItem(key, String(rank));
  } catch {
    /* private mode etc. */
  }
}

/**
 * The rows with the admin preview's simulated wins added to my entry, ranked
 * again. Others keep their place on a tie: you have to pass someone to
 * overtake them. Without simulated wins the server's ranks are used as is.
 */
function withSimulation(data: LeaderboardData, category: LeaderboardCategory, simWins: number): LeaderboardData {
  if (simWins === 0 || !data.me) return data;
  const me: LeaderboardEntry = {
    ...data.me,
    wins: data.me.wins + simWins,
    earned: data.me.earned + simWins * REWARDS.win,
    balance: data.me.balance + simWins * REWARDS.win,
  };
  const others = data.rows.filter((r) => !r.isMe);
  const myScore = scoreOf(me, category);
  const ahead = others.filter((r) => scoreOf(r, category) >= myScore).length;
  const inList = ahead < LEADERBOARD_SIZE || (data.me.rank !== null && data.me.rank <= LEADERBOARD_SIZE);
  const myRank = inList ? ahead + 1 : data.me.rank;
  me.rank = myScore > 0 ? myRank : null;
  if (!inList || me.rank === null) return { rows: others.slice(0, LEADERBOARD_SIZE), me };
  const rows = [...others.slice(0, ahead), me, ...others.slice(ahead)]
    .slice(0, LEADERBOARD_SIZE)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  return { rows, me };
}

function ClassBadge({ classId, compact = false }: { classId: string; compact?: boolean }): ReactElement {
  const accent = CLASS_ACCENT[classId] ?? "#d9be84";
  return (
    <span className={`rank-class${compact ? " compact" : ""}`} style={{ ["--rank-class" as string]: accent }} title={className(classId)}>
      {/* Hand-authored SVG from src/icons.ts, not user input. */}
      <span className="rank-class-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: classIconMarkup({ id: classId }) }} />
      {compact ? null : <span className="rank-class-name">{className(classId)}</span>}
    </span>
  );
}

function RankUpBadge({ delta }: { delta: number }): ReactElement {
  return (
    <span className="rank-up-badge">
      ▲ +{delta} Rank{delta === 1 ? "" : "s"}
    </span>
  );
}

const CROWN =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="currentColor"/></svg>';
const MEDAL =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h4l1 5-3 1zM17 2h-4l-1 5 3 1z" fill="currentColor" opacity=".7"/><circle cx="12" cy="15" r="6.5" fill="currentColor"/><circle cx="12" cy="15" r="3.5" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.4"/></svg>';

function PodiumCard({
  entry,
  category,
  flash,
}: {
  entry: LeaderboardEntry;
  category: LeaderboardCategory;
  flash: number | null;
}): ReactElement {
  const place = entry.rank ?? 0;
  const tier = place === 1 ? "gold" : place === 2 ? "silver" : "bronze";
  return (
    <div className={`rank-podium-slot ${tier}`}>
      <div className={`rank-podium-card${entry.isMe ? " me" : ""}${entry.isMe && flash ? " flash" : ""}`}>
        <span className="rank-podium-medal" dangerouslySetInnerHTML={{ __html: place === 1 ? CROWN : MEDAL }} />
        {entry.isMe && flash ? (
          <span className="rank-podium-up">
            <RankUpBadge delta={flash} />
          </span>
        ) : null}
        <PlayerAvatar url={entry.avatarUrl} className={`rank-podium-avatar${place === 1 ? " lg" : ""}`} />
        <div className="rank-podium-name">
          <span>{entry.name}</span>
          {entry.isMe ? <span className="rank-you">You</span> : null}
        </div>
        <ClassBadge classId={entry.mainClass} />
        <div className="rank-podium-score">{category === "wins" ? fmt(entry.wins) : fmt(entry.earned)}</div>
        <div className="rank-podium-unit">{category === "wins" ? "Wins" : "Gold earned"}</div>
        <div className="rank-podium-sub">
          {category === "wins"
            ? `${entry.wins} - ${entry.losses}${entry.draws ? ` - ${entry.draws}` : ""} · ${winRate(entry).toFixed(1)}%`
            : `${fmt(entry.balance)} G balance`}
        </div>
      </div>
      <div className="rank-podium-base">#{place}</div>
    </div>
  );
}

function RankRow({
  entry,
  category,
  flash,
  overtaken,
  rowRef,
}: {
  entry: LeaderboardEntry;
  category: LeaderboardCategory;
  flash: number | null;
  overtaken: boolean;
  rowRef?: Ref<HTMLLIElement>;
}): ReactElement {
  const rate = winRate(entry);
  return (
    <li
      ref={rowRef}
      className={`rank-row${entry.isMe ? " me" : ""}${entry.isMe && flash ? " flash" : ""}${overtaken ? " overtaken" : ""}`}
    >
      <span className="rank-row-rank">{entry.rank}</span>
      <span className="rank-row-player">
        <PlayerAvatar url={entry.avatarUrl} className="rank-row-avatar" />
        <span className="rank-row-who">
          <span className="rank-row-name">
            <span className="rank-row-name-text">{entry.name}</span>
            {entry.isMe ? <span className="rank-you">You</span> : null}
            {entry.isMe && flash ? <RankUpBadge delta={flash} /> : null}
            {overtaken ? <span className="rank-down">▼ 1</span> : null}
          </span>
          <span className="rank-row-record">
            <span className="rank-row-class-sm">
              <ClassBadge classId={entry.mainClass} compact />
            </span>
            {entry.wins} W - {entry.losses} L{entry.draws ? ` - ${entry.draws} D` : ""}
          </span>
        </span>
      </span>
      <span className="rank-row-class">
        <ClassBadge classId={entry.mainClass} />
      </span>
      <span className="rank-row-mid">
        {category === "wins" ? (
          <>
            <span className="rank-row-rate">{rate.toFixed(1)}%</span>
            <span className="rank-row-bar">
              <span className={rate >= 60 ? "hi" : rate >= 50 ? "mid" : "lo"} style={{ width: `${Math.min(100, rate)}%` }} />
            </span>
          </>
        ) : (
          <span className="rank-row-balance">{fmt(entry.balance)} G</span>
        )}
      </span>
      <span className="rank-row-score">{category === "wins" ? fmt(entry.wins) : `${fmt(entry.earned)} G`}</span>
    </li>
  );
}

function MyRankBar({
  me,
  above,
  category,
  flash,
  onFind,
}: {
  me: LeaderboardEntry | null;
  above: LeaderboardEntry | null;
  category: LeaderboardCategory;
  flash: number | null;
  onFind: () => void;
}): ReactElement {
  if (!me) {
    return (
      <div className="rank-me-bar">
        <div className="rank-me-inner">
          <p className="rank-me-empty">Log in and play random matches to get on the leaderboard.</p>
        </div>
      </div>
    );
  }
  const myScore = scoreOf(me, category);
  let gap: string;
  let progress = 100;
  if (me.rank === null) {
    gap =
      category === "wins"
        ? "Win a random match to get on the leaderboard"
        : "Earn Gold in random matches to get on the leaderboard";
    progress = 0;
  } else if (me.rank === 1) {
    gap = "You hold Rank #1. Defend the crown!";
  } else if (above) {
    const need = scoreOf(above, category) - myScore + 1; // a tie keeps them ahead
    progress = Math.max(4, Math.min(99, (myScore / (scoreOf(above, category) + 1)) * 100));
    if (category === "wins") gap = `${need} win${need === 1 ? "" : "s"} away from Rank #${above.rank}`;
    else {
      const wins = Math.ceil(need / REWARDS.win);
      gap = `${fmt(need)} G away from Rank #${above.rank} (about ${wins} win${wins === 1 ? "" : "s"})`;
    }
  } else {
    gap = `Climb into the Top ${LEADERBOARD_SIZE} to see who's ahead of you`;
  }
  return (
    <div className="rank-me-bar">
      <div className={`rank-me-inner${flash ? " flash" : ""}`}>
        {flash ? (
          <span className="rank-me-up">
            <RankUpBadge delta={flash} />
          </span>
        ) : null}
        <div className="rank-me-left">
          <div className="rank-me-rank">
            <span className="rank-me-label">My rank</span>
            <span className="rank-me-num">{me.rank === null ? "–" : `#${me.rank}`}</span>
          </div>
          <PlayerAvatar url={me.avatarUrl} className="rank-me-avatar" />
          <div className="rank-me-who">
            <span className="rank-me-name">
              {me.name} <ClassBadge classId={me.mainClass} compact />
            </span>
            <span className="rank-me-record">
              {me.wins} W - {me.losses} L · {winRate(me).toFixed(1)}%
            </span>
          </div>
        </div>
        <div className="rank-me-gap">
          <div className="rank-me-gap-text">
            <span>{gap}</span>
            <strong>{category === "wins" ? `${fmt(me.wins)} W` : `${fmt(me.earned)} G`}</strong>
          </div>
          <div className="rank-me-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
        {me.rank !== null ? (
          <button type="button" className="gallery-pill rank-find" onClick={onFind}>
            Find me
          </button>
        ) : null}
      </div>
    </div>
  );
}

export interface LeaderboardProps {
  accountId: string;
  /** Admins see "Simulate +1 win", a local preview of climbing the ranks (nothing is saved). */
  isAdmin: boolean;
  onBack: () => void;
}

/** Leaderboard screen (React shell): random-match wins and lifetime Gold earned, all-time. */
export function Leaderboard({ accountId, isAdmin, onBack }: LeaderboardProps): ReactElement {
  const [category, setCategory] = useState<LeaderboardCategory>("wins");
  const [data, setData] = useState<Partial<Record<LeaderboardCategory, LeaderboardData>>>({});
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [simWins, setSimWins] = useState(0);
  const [flash, setFlash] = useState<{ id: number; delta: number; overtaken: Set<string> } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; sub: string } | null>(null);

  useEffect(() => {
    if (data[category]) return;
    let cancelled = false;
    setError(null);
    fetchLeaderboard(category).then(
      (d) => !cancelled && setData((s) => ({ ...s, [category]: d })),
      (err: Error) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [category, data]);

  const loaded = data[category] ?? null;
  const view = useMemo(() => (loaded ? withSimulation(loaded, category, simWins) : null), [loaded, category, simWins]);
  const me = view?.me ?? null;
  const myRank = me?.rank ?? null;
  const rows = view?.rows ?? [];
  const top3 = rows.slice(0, 3);
  const q = query.trim().toLowerCase();
  const rest = rows
    .slice(3)
    .filter((r) => !q || r.name.toLowerCase().includes(q) || className(r.mainClass).toLowerCase().includes(q));
  const above = myRank !== null && myRank > 1 ? (rows.find((r) => r.rank === myRank - 1) ?? null) : null;

  const showRankUp = useCallback(
    (delta: number, passed: LeaderboardEntry[], rank: number) => {
      const id = Date.now();
      setFlash({ id, delta, overtaken: new Set(passed.map((p) => p.name)) });
      setToast({
        id,
        text: passed.length === 1 ? `You overtook ${passed[0]?.name}!` : `You climbed ${delta} rank${delta === 1 ? "" : "s"}!`,
        sub: `Now Rank #${rank} in ${category === "wins" ? "Most Wins" : "Total Gold Earned"}`,
      });
    },
    [category]
  );

  // Rank-up: against the rank this account last saw (real games), and while
  // an admin simulates wins on this screen.
  const lastRank = useRef<{ category: LeaderboardCategory; rank: number | null } | null>(null);
  useEffect(() => {
    if (!view) return;
    const prev = lastRank.current;
    const key = seenKey(accountId, category);
    let before: number | null = null;
    if (prev && prev.category === category) before = prev.rank;
    else if (simWins === 0) before = readSeenRank(key);
    if (myRank !== null && (before === null || myRank < before)) {
      if (before !== null) {
        const passed = rows.filter((r) => !r.isMe && r.rank !== null && r.rank > myRank && r.rank <= before);
        showRankUp(before - myRank, passed, myRank);
      }
    }
    lastRank.current = { category, rank: myRank };
    if (simWins === 0 && myRank !== null) writeSeenRank(key, myRank);
  }, [view]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), RANK_UP_MS);
    return () => window.clearTimeout(t);
  }, [flash]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), RANK_UP_MS + 400);
    return () => window.clearTimeout(t);
  }, [toast]);

  const listRef = useRef<HTMLOListElement>(null);
  const myRowRef = useRef<HTMLLIElement>(null);
  const podiumRef = useRef<HTMLDivElement>(null);
  const findMe = useCallback(() => {
    if (myRank !== null && myRank <= 3) {
      podiumRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const list = listRef.current;
    const row = myRowRef.current;
    if (!list || !row) return;
    list.scrollTo({ top: row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2, behavior: "smooth" });
    list.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [myRank]);
  useEffect(() => {
    if (flash) findMe();
  }, [flash]);

  const switchCategory = (c: LeaderboardCategory): void => {
    setFlash(null);
    setToast(null);
    setCategory(c);
  };
  const refresh = (): void => {
    setFlash(null);
    setToast(null);
    lastRank.current = null;
    setSimWins(0);
    setData({});
  };

  const isWins = category === "wins";

  return (
    <div className="shell-screen gallery-screen rank-screen">
      <div className="gallery-backdrop" aria-hidden="true" />
      <header className="gallery-header">
        <div className="gallery-heading">
          <h1 className="gallery-title">Leaderboard</h1>
          <p className="gallery-subtitle">
            <span>Random matches only</span>
            <span className="gallery-sep" aria-hidden="true" />
            <span>All-time</span>
          </p>
        </div>
        <button type="button" className="gallery-pill gallery-back" onClick={onBack}>
          ← Back
        </button>
      </header>

      {isAdmin ? (
        <div className="rank-debug">
          <span className="rank-debug-label">Admin preview</span>
          <button type="button" className="rank-debug-btn" onClick={() => setSimWins((n) => n + 1)} disabled={!me}>
            Simulate +1 Match Win (+{REWARDS.win} G)
          </button>
          <button type="button" className="rank-debug-reset" onClick={refresh}>
            Reset
          </button>
          {simWins > 0 ? (
            <span className="rank-debug-note">
              +{simWins} simulated · not saved
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="rank-controls">
        <div className="gallery-filters rank-tabs" role="tablist" aria-label="Ranking">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              className={`gallery-pill gallery-filter${category === c.id ? " active" : ""}`}
              onClick={() => switchCategory(c.id)}
            >
              <span aria-hidden="true">{c.icon}</span> {c.label}
            </button>
          ))}
        </div>
        <div className="rank-timeframe" aria-label="Timeframe">
          <span className="rank-time-pill active">All-Time</span>
          <span className="rank-time-pill soon" title="Seasons are coming later">
            Season 1 · Coming soon
          </span>
        </div>
        <label className="rank-search">
          <span className="rank-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            id="rank-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players or classes"
          />
        </label>
      </div>

      {error ? (
        <p className="record-card record-error">Couldn&apos;t load the leaderboard: {error}</p>
      ) : !view ? (
        <p className="rank-loading">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rank-loading">No one is ranked yet. Win a random match to take #1!</p>
      ) : (
        <>
          <div ref={podiumRef} className="rank-podium">
            {[top3[1], top3[0], top3[2]].map((e, i) =>
              e ? (
                <PodiumCard key={`${e.rank}-${e.name}`} entry={e} category={category} flash={flash?.delta ?? null} />
              ) : (
                <div key={`empty-${i}`} className="rank-podium-slot empty" />
              )
            )}
          </div>

          {rows.length > 3 ? (
            <section className="rank-table" aria-label="Rankings">
              <div className="rank-row rank-head">
                <span className="rank-row-rank">Rank</span>
                <span className="rank-row-player">Player</span>
                <span className="rank-row-class">Main class</span>
                <span className="rank-row-mid">{isWins ? "Win rate" : "Balance"}</span>
                <span className="rank-row-score">{isWins ? "Total wins" : "Total gold"}</span>
              </div>
              <ol ref={listRef} className="rank-list">
                {rest.map((e) => (
                  <RankRow
                    key={`${e.rank}-${e.name}`}
                    entry={e}
                    category={category}
                    flash={flash?.delta ?? null}
                    overtaken={!!flash?.overtaken.has(e.name) && !e.isMe}
                    rowRef={e.isMe ? myRowRef : undefined}
                  />
                ))}
                {rest.length === 0 ? <li className="rank-empty">No players match &quot;{query}&quot;.</li> : null}
              </ol>
              <p className="rank-foot">
                {isWins
                  ? "Ties: higher win rate first. You have to pass a player to take their rank."
                  : "Ranked by lifetime Gold earned. Spending Gold in the Shop never lowers your rank."}
              </p>
            </section>
          ) : null}
        </>
      )}

      <MyRankBar me={me} above={above} category={category} flash={flash?.delta ?? null} onFind={findMe} />

      {toast ? (
        <div key={toast.id} className="rank-toast" role="status">
          <span className="rank-toast-icon" aria-hidden="true">
            ▲
          </span>
          <span>
            <strong>{toast.text}</strong>
            <span>{toast.sub}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
