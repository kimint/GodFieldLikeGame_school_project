import { useEffect, useRef, type ReactElement } from "react";
import Phaser from "phaser";
import { TutorialBattleScene } from "../scenes/TutorialBattleScene.ts";
import { createPhaserGame } from "./phaserGame.ts";

export interface PhaserTutorialProps {
  onExit: () => void;
}

/** Guided practice match: the Phaser TutorialBattleScene owns all frames; React only mounts it. */
export function PhaserTutorial({ onExit }: PhaserTutorialProps): ReactElement {
  const mountRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const game = createPhaserGame(mount, []);
    game.events.once(Phaser.Core.Events.READY, () => {
      // The scene picks its own class and decks; playerClass is unused.
      game.scene.add("TutorialBattleScene", TutorialBattleScene, true, { onExit: () => onExitRef.current() });
    });
    return () => {
      game.destroy(true);
    };
  }, []);

  return <div className="phaser-mount" ref={mountRef} />;
}
