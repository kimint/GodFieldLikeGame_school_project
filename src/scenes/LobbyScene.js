// Online PvP lobby: creates a room (and shows its code to share) or joins one
// by code, then waits until the server has set up the battle and hands off to
// OnlineBattleScene. See src/online/matchApi.js.

import Phaser from "phaser";
import {
  createMatch,
  ensureSignedIn,
  fetchHand,
  fetchMatch,
  fetchMatchVersion,
  joinMatch,
  leaveMatch,
  watchMatch,
} from "../online/matchApi.js";
import { COLORS, TEXT, FONT_FAMILY, createButton } from "./theme.js";

export class LobbyScene extends Phaser.Scene {
  constructor() {
    super("LobbyScene");
  }

  // data: { mode: "create" | "join", playerClass, code? }
  create(data) {
    this.matchId = null;
    this.userId = null;
    this.starting = false;
    this.stopWatching = null;
    this.events.once("shutdown", () => this.stopWatching?.());

    this.add
      .text(480, 32, "Godfield-lite — Online", { fontFamily: FONT_FAMILY, fontSize: "28px", fontStyle: "700", color: TEXT.white })
      .setOrigin(0.5, 0);

    this.add
      .text(480, 80, `Playing as ${data.playerClass.name}`, { fontFamily: FONT_FAMILY, fontSize: "14px", color: TEXT.muted })
      .setOrigin(0.5, 0);

    this.codeText = this.add
      .text(480, 200, "", { fontFamily: FONT_FAMILY, fontSize: "56px", fontStyle: "700", color: TEXT.white })
      .setOrigin(0.5, 0);

    this.statusText = this.add
      .text(480, 300, "", {
        fontFamily: FONT_FAMILY,
        fontSize: "15px",
        color: TEXT.body,
        align: "center",
        wordWrap: { width: 640 },
      })
      .setOrigin(0.5, 0);

    createButton(this, 425, 420, 110, 40, "Back", {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => this.onBack(),
    });

    this.start(data);
  }

  async start({ mode, playerClass, code }) {
    try {
      this.statusText.setText("Connecting…");
      this.userId = await ensureSignedIn();

      if (mode === "create") {
        const match = await createMatch(playerClass.id);
        this.matchId = match.id;
        this.showCode(match.code);
        this.statusText.setText("Send this room code to a friend. Waiting for them to join…\n(click the code to copy it)");
      } else {
        const match = await joinMatch(code, playerClass.id);
        this.matchId = match.id;
        this.statusText.setText("Joined! Starting the battle…");
      }

      if (!this.scene.isActive()) return; // left while we were waiting on the server
      this.stopWatching = watchMatch(this.matchId, () => this.checkStarted());
    } catch (err) {
      if (this.scene.isActive()) this.statusText.setText(err.message);
    }
  }

  showCode(code) {
    this.codeText.setText(code);
    this.codeText.setInteractive({ useHandCursor: true });
    this.codeText.on("pointerdown", () => {
      navigator.clipboard?.writeText(code).then(
        () => this.statusText.setText("Code copied! Waiting for your friend to join…"),
        () => {}
      );
    });
  }

  // The battle is ready once the server has set it up, which moves the
  // match's round from 0 to 1. Polls only the tiny version columns until
  // then, and fetches the full row + hand once.
  async checkStarted() {
    if (this.starting) return;
    let version;
    try {
      version = await fetchMatchVersion(this.matchId);
    } catch {
      return; // try again on the next event/poll
    }
    if (this.starting || !this.scene.isActive()) return;

    if (version.round === 0) {
      if (version.status === "finished") {
        this.statusText.setText("This room was closed.");
        this.stopWatching?.();
      }
      return;
    }

    this.starting = true;
    try {
      const [match, hand] = await Promise.all([fetchMatch(this.matchId), fetchHand(this.matchId, this.userId)]);
      if (!this.scene.isActive()) return;
      this.scene.start("OnlineBattleScene", { matchId: this.matchId, userId: this.userId, match, hand });
    } catch {
      this.starting = false; // try again on the next event/poll
    }
  }

  onBack() {
    // Close our room if nobody has joined yet, so it doesn't sit there open.
    if (this.matchId && !this.starting) leaveMatch(this.matchId).catch(() => {});
    this.scene.start("ClassSelectScene");
  }
}
