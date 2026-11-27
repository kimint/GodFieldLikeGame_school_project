import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useCatalog } from "../hooks/useCatalog.ts";
import { useAuth } from "../hooks/useAuth.ts";
import { AuthScreen } from "../components/AuthScreen.tsx";
import { ClassSelect } from "../components/ClassSelect.tsx";
import { DeckBuilder } from "../components/DeckBuilder.tsx";
import { Gallery } from "../components/Gallery.tsx";
import { Shop } from "../components/Shop.tsx";
import { MatchHistory } from "../components/MatchHistory.tsx";
import { ClassStats } from "../components/ClassStats.tsx";
import { AccountSettings } from "../components/AccountSettings.tsx";
import { PhaserTutorial } from "../components/PhaserTutorial.tsx";
import { Lobby } from "../components/Lobby.tsx";
import { Dialog, type DialogProps } from "../components/Dialog.tsx";
import { PhaserBattle } from "../components/PhaserBattle.tsx";
import { RandomLobby } from "../components/RandomLobby.tsx";
import { PhaserRandomBattle } from "../components/PhaserRandomBattle.tsx";
import type { RandomMatch } from "../online/randomMatch.ts";
import { findClassById } from "../model/catalog.ts";
import { validateDeckList, type DeckListEntry } from "../model/decks.ts";
import type { ClassDef } from "../model/classes.ts";
import { onlineAvailable } from "../online/supabaseClient.ts";
import { useIsAdmin } from "../hooks/useIsAdmin.ts";
import { logOut, markTutorialSeen } from "../online/authApi.ts";
import { listDecks, type SavedDeck } from "../online/decksApi.ts";
import { fetchMatchHistory, recordCpuGame, type MatchHistoryData } from "../online/historyApi.ts";
import { fetchEconomy } from "../online/shopApi.ts";
import { lockedCardsIn, ownsClass, type Economy } from "../model/shop.ts";
import type { FinishedGame } from "../scenes/BattleScene.ts";

// The deck a player takes into a match: a saved deck, or the starter deck
// (id null, list null).
interface DeckChoice {
  id: string | null;
  name: string;
  list: DeckListEntry[] | null;
}

type Screen =
  | { name: "menu" }
  | { name: "gallery" }
  | { name: "shop" }
  | { name: "record" }
  | { name: "account" }
  | { name: "tutorial" }
  | { name: "decks"; classId: string }
  | { name: "battle"; playerClassId: string; cpuClassId: string | null; deck: DeckChoice }
  | { name: "class-stats" }
  | { name: "lobby-create"; playerClass: ClassDef; deck: DeckChoice }
  | { name: "lobby-join"; playerClass: ClassDef; deck: DeckChoice; code: string }
  | { name: "lobby-random"; playerClass: ClassDef; deck: DeckChoice }
  | { name: "random-battle"; match: RandomMatch };

/** React shell: menus and popups. The Phaser canvas owns all battle frames. */
export function App(): ReactElement {
  const catalog = useCatalog();
  const auth = useAuth();
  const [screen, setScreen] = useState<Screen>({ name: "menu" });
  const [dialog, setDialog] = useState<DialogProps | null>(null);
  const [lastClassId, setLastClassId] = useState<string | null>(null);
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [decksError, setDecksError] = useState<string | null>(null);
  const [selectedDeckIds, setSelectedDeckIds] = useState<Record<string, string | null>>({});
  const [history, setHistory] = useState<MatchHistoryData | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Gold and unlocks (null until loaded, and when the shop isn't set up on
  // this database -- then every class and card stays open).
  const [economy, setEconomy] = useState<Economy | null>(null);

  const accountId = auth.account?.id ?? null;
  // Admin-only tools (e.g. the reward debug bar) render when this is true.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used once the debug bar lands
  const isAdmin = useIsAdmin(accountId);
  const needsTutorialPrompt = auth.account?.needsTutorialPrompt ?? false;
  // Accounts already asked this session, so the prompt doesn't come back while
  // the "tutorial seen" flag is still saving.
  const tutorialAsked = useRef(new Set<string>());

  const reloadDecks = useCallback(async (): Promise<void> => {
    if (!accountId) return;
    try {
      setDecks(await listDecks());
      setDecksError(null);
    } catch (err) {
      setDecksError((err as Error).message);
    }
  }, [accountId]);

  // The "My record" screen's data is loaded here, not by the screen itself,
  // so opening it again doesn't refetch -- only a finished game can change it.
  const reloadHistory = useCallback(async (): Promise<void> => {
    if (!accountId) return;
    // Gold changes with every random match too.
    fetchEconomy()
      .then(setEconomy)
      .catch((err: Error) => console.warn("Couldn't load Gold / unlocks:", err.message));
    try {
      setHistory(await fetchMatchHistory());
      setHistoryError(null);
    } catch (err) {
      setHistoryError((err as Error).message);
    }
  }, [accountId]);

  // A finished vs-CPU game counts toward its class's win rate (logged in
  // only). A failed write only costs the stat, not the game.
  const onCpuGameOver = useCallback(
    (game: FinishedGame): void => {
      if (!accountId) return;
      recordCpuGame(game.playerClassId, game.result)
        .then(() => reloadHistory())
        .catch((err: Error) => console.warn("Couldn't record the vs-CPU game:", err.message));
    },
    [accountId, reloadHistory]
  );

  // A different (or no) account: drop the old one's decks and history and go back to the menu.
  useEffect(() => {
    setDecks([]);
    setDecksError(null);
    setSelectedDeckIds({});
    setHistory(null);
    setHistoryError(null);
    setEconomy(null);
    setScreen({ name: "menu" });
    void reloadDecks();
    void reloadHistory();
  }, [accountId, reloadDecks, reloadHistory]);

  // A brand-new account: offer the tutorial once. Either answer is saved to
  // the account, so it isn't asked again.
  useEffect(() => {
    if (!accountId || !needsTutorialPrompt || tutorialAsked.current.has(accountId)) return;
    tutorialAsked.current.add(accountId);
    const answer = (start: boolean): void => {
      setDialog(null);
      if (start) setScreen({ name: "tutorial" });
      markTutorialSeen().catch((err: Error) => console.warn("Couldn't save the tutorial prompt answer:", err.message));
    };
    setDialog({
      kind: "confirm",
      title: `Welcome, ${auth.account?.username ?? "Player"}!`,
      message: "New to Zenkake? The tutorial is a guided practice match that shows you how everything works, step by step. You can also open it later from the home screen.",
      confirmLabel: "Start tutorial",
      cancelLabel: "Skip",
      onConfirm: () => answer(true),
      onCancel: () => answer(false),
    });
  }, [accountId, needsTutorialPrompt, auth.account?.username]);

  if (!catalog.ready || !auth.ready) {
    return (
      <div className="shell-screen">
        <p className="shell-subtitle">Loading game data…</p>
      </div>
    );
  }

  if (onlineAvailable && !auth.account) return <AuthScreen />;

  const showError = (title: string, message: string): void => {
    setDialog({ kind: "confirm", title, message, confirmLabel: "OK", onConfirm: () => setDialog(null), onCancel: () => setDialog(null) });
  };

  const askConfirm = (title: string, message: string, confirmLabel: string, onYes: () => void): void => {
    setDialog({
      kind: "confirm",
      title,
      message,
      confirmLabel,
      danger: true,
      onConfirm: () => {
        setDialog(null);
        onYes();
      },
      onCancel: () => setDialog(null),
    });
  };

  // The deck picked for a class, checked against the deck rules (the catalog
  // may have changed since it was saved). null = not playable, error shown.
  const deckFor = (classDef: ClassDef): DeckChoice | null => {
    if (!ownsClass(economy, classDef.id)) {
      showError("Class locked", `Unlock ${classDef.name} in the Shop first.`);
      return null;
    }
    const id = selectedDeckIds[classDef.id] ?? null;
    const saved = id ? decks.find((d) => d.id === id) : undefined;
    if (!saved) return { id: null, name: "Starter deck", list: null };
    const problem = validateDeckList(classDef, saved.cards);
    if (problem) {
      showError("Deck can't be used", `"${saved.name}": ${problem} Edit it in the deck builder or pick another deck.`);
      return null;
    }
    const locked = lockedCardsIn(economy, saved.cards);
    if (locked.length) {
      showError(
        "Deck can't be used",
        `"${saved.name}" uses cards you haven't unlocked: ${locked.join(", ")}. Unlock them in the Shop, edit the deck, or pick the starter deck.`
      );
      return null;
    }
    return { id: saved.id, name: saved.name, list: saved.cards };
  };

  const startWith = (classId: string, go: (playerClass: ClassDef, deck: DeckChoice) => void): void => {
    setLastClassId(classId);
    const playerClass = findClassById(classId);
    const deck = deckFor(playerClass);
    if (deck) go(playerClass, deck);
  };

  // Play vs CPU: pick the CPU's class (or a random one), then the match starts.
  const askCpuClass = (playerClass: ClassDef, deck: DeckChoice): void => {
    setDialog({
      kind: "choice",
      title: "Choose your opponent",
      message: `Which class should the CPU play against your ${playerClass.name}?`,
      options: [
        { value: "", label: "Random" },
        ...catalog.classes.map((c) => ({ value: c.id, label: c.name })),
      ],
      confirmLabel: "Start match",
      onConfirm: (cpuClassId) => {
        setDialog(null);
        setScreen({ name: "battle", playerClassId: playerClass.id, cpuClassId: cpuClassId || null, deck });
      },
      onCancel: () => setDialog(null),
    });
  };

  const askJoinCode = (playerClass: ClassDef, deck: DeckChoice): void => {
    setDialog({
      kind: "prompt",
      title: "Join a room",
      message: "Enter the room code your friend sent you.",
      input: { placeholder: "ABCDE", maxLength: 5, uppercase: true },
      confirmLabel: "Join",
      onConfirm: (code: string) => {
        setDialog(null);
        setScreen({ name: "lobby-join", playerClass, deck, code });
      },
      onCancel: () => setDialog(null),
    });
  };

  const toMenu = (): void => setScreen({ name: "menu" });
  const logOutNow = (): void => {
    logOut().catch((err: Error) => showError("Couldn't log out", err.message));
  };

  // Back to the menu from an online battle: the game may have just been
  // recorded, so refresh the record. (vs-CPU games aren't recorded.)
  const toMenuAfterOnlineGame = (): void => {
    toMenu();
    void reloadHistory();
  };

  // Random matches are recorded by the Colyseus server, and a forfeit is only
  // written after this player has already left -- refresh once more a moment
  // later to pick that up.
  const toMenuAfterRandomGame = (): void => {
    toMenuAfterOnlineGame();
    setTimeout(() => void reloadHistory(), 2000);
  };

  // The in-battle Account settings button (after "Are you sure?"): the scene
  // has already left the match. Only offered with an account.
  const toAccount = auth.account ? (): void => setScreen({ name: "account" }) : null;
  const toAccountAfterRandomGame = toAccount
    ? (): void => {
        toAccount();
        setTimeout(() => void reloadHistory(), 2000); // a forfeit is recorded just after leaving
      }
    : null;

  let body: ReactElement;
  switch (screen.name) {
    case "gallery":
      body = <Gallery onBack={toMenu} />;
      break;
    case "shop":
      body = economy ? (
        <Shop classes={catalog.classes} economy={economy} onEconomyChange={setEconomy} onBack={toMenu} />
      ) : (
        <></>
      );
      break;
    case "tutorial":
      body = <PhaserTutorial onExit={toMenu} onAccountSettings={toAccount} />;
      break;
    case "class-stats":
      body = <ClassStats onBack={toMenu} />;
      break;
    case "record":
      body = (
        <MatchHistory
          username={auth.account?.username ?? "Player"}
          history={history}
          error={historyError}
          onBack={toMenu}
        />
      );
      break;
    case "account":
      body = auth.account ? (
        <AccountSettings account={auth.account} history={history} onBack={toMenu} onLogout={logOutNow} />
      ) : (
        <></>
      );
      break;
    case "decks": {
      const classDef = findClassById(screen.classId);
      body = (
        <DeckBuilder
          classDef={classDef}
          economy={economy}
          decks={decks.filter((d) => d.classId === classDef.id)}
          initialDeckId={selectedDeckIds[classDef.id] ?? null}
          onDecksChanged={(deckId) => {
            setSelectedDeckIds((s) => ({ ...s, [classDef.id]: deckId }));
            void reloadDecks();
          }}
          confirm={askConfirm}
          onBack={toMenu}
        />
      );
      break;
    }
    case "battle":
      body = (
        <PhaserBattle
          playerClassId={screen.playerClassId}
          playerDeckList={screen.deck.list}
          cpuClassId={screen.cpuClassId}
          onGameOver={onCpuGameOver}
          onExit={toMenu}
          onAccountSettings={toAccount}
        />
      );
      break;
    case "lobby-create":
      body = (
        <Lobby
          mode="create"
          playerClass={screen.playerClass}
          deckId={screen.deck.id}
          deckName={screen.deck.name}
          onReady={(match) => setScreen({ name: "random-battle", match })}
          onBack={toMenu}
        />
      );
      break;
    case "lobby-join":
      body = (
        <Lobby
          mode="join"
          playerClass={screen.playerClass}
          deckId={screen.deck.id}
          deckName={screen.deck.name}
          code={screen.code}
          onReady={(match) => setScreen({ name: "random-battle", match })}
          onBack={toMenu}
        />
      );
      break;
    case "lobby-random":
      body = (
        <RandomLobby
          playerClass={screen.playerClass}
          deckId={screen.deck.id}
          deckName={screen.deck.name}
          onReady={(match) => setScreen({ name: "random-battle", match })}
          onBack={toMenu}
        />
      );
      break;
    case "random-battle":
      body = (
        <PhaserRandomBattle
          match={screen.match}
          onExit={toMenuAfterRandomGame}
          onAccountSettings={toAccountAfterRandomGame}
        />
      );
      break;
    case "menu":
    default:
      body = (
        <ClassSelect
          classes={catalog.classes}
          initialClassId={lastClassId}
          account={auth.account}
          economy={economy}
          onEconomyChange={setEconomy}
          onOpenShop={() => setScreen({ name: "shop" })}
          decks={decks}
          decksError={decksError}
          selectedDeckIds={selectedDeckIds}
          onSelectDeck={(classId, deckId) => setSelectedDeckIds((s) => ({ ...s, [classId]: deckId }))}
          onEditDecks={(classId) => {
            setLastClassId(classId);
            setScreen({ name: "decks", classId });
          }}
          onLogout={logOutNow}
          onOpenAccount={() => setScreen({ name: "account" })}
          onPlayCpu={(classId) => startWith(classId, askCpuClass)}
          onCreateOnline={(classId) =>
            startWith(classId, (playerClass, deck) => setScreen({ name: "lobby-create", playerClass, deck }))
          }
          onJoinOnline={(classId) => startWith(classId, askJoinCode)}
          onRandomOnline={(classId) =>
            startWith(classId, (playerClass, deck) => setScreen({ name: "lobby-random", playerClass, deck }))
          }
          onOpenGallery={() => setScreen({ name: "gallery" })}
          onOpenRecord={() => setScreen({ name: "record" })}
          onOpenClassStats={() => setScreen({ name: "class-stats" })}
          onOpenTutorial={() => setScreen({ name: "tutorial" })}
        />
      );
      break;
  }

  return (
    <>
      {body}
      {dialog ? <Dialog {...dialog} /> : null}
    </>
  );
}
