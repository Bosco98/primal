import type { Action, Band } from '../types.js';

export interface KeyboardDriver {
  band: Band;
  /** Drain the actions performed since the last call. */
  drain(): Action[];
  /** 0..1 stand-in for effort, from how busy the keyboard has been. */
  intensity(): number;
  /** Pointer position in 0..1 screen space, for the hand cursors. */
  pointer: { x: number; y: number };
  detach(): void;
}

/**
 * Keyboard and mouse in place of a body.
 *
 * This replaced a whole `FakeConsole` that spoke the wire protocol into a
 * MessagePort. With no protocol left it is just a few listeners and a queue —
 * but it is still the single most important file for actually finishing the
 * game, because nobody iterates on a difficulty curve if every reload means
 * standing up and doing thirty jumps.
 *
 *   A / D      hop left / right      W or Space   jump
 *   S          duck                  mouse        moves your hands
 */
export function attachKeyboard(target: EventTarget = window): KeyboardDriver {
  const pending: Action[] = [];
  const held = new Set<string>();
  let lastActivity = 0;

  const driver: KeyboardDriver = {
    band: 0,
    pointer: { x: 0.7, y: 0.5 },
    drain() {
      return pending.splice(0);
    },
    intensity() {
      // Decays toward rest so the pack still closes in if you stop typing —
      // the effort mechanic has to be exercisable at a desk or it never gets
      // tuned before someone stands in front of a camera.
      const idle = (performance.now() - lastActivity) / 1000;
      return idle < 1.2 ? 0.85 : Math.max(0.15, 0.85 - (idle - 1.2) * 0.35);
    },
    detach() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
    },
  };

  function onKeyDown(event: Event): void {
    const e = event as KeyboardEvent;
    if (e.repeat) return;
    lastActivity = performance.now();
    switch (e.code) {
      case 'KeyA':
        held.add('L');
        driver.band = -1;
        break;
      case 'KeyD':
        held.add('R');
        driver.band = 1;
        break;
      case 'KeyW':
      case 'Space':
        pending.push('JUMP');
        e.preventDefault();
        break;
      case 'KeyS':
        pending.push('DUCK');
        e.preventDefault();
        break;
      default:
        break;
    }
  }

  function onKeyUp(event: Event): void {
    const code = (event as KeyboardEvent).code;
    if (code === 'KeyA') held.delete('L');
    if (code === 'KeyD') held.delete('R');
    driver.band = held.has('L') ? -1 : held.has('R') ? 1 : 0;
  }

  function onMouseMove(event: MouseEvent): void {
    driver.pointer.x = event.clientX / window.innerWidth;
    driver.pointer.y = event.clientY / window.innerHeight;
    lastActivity = performance.now();
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  return driver;
}
