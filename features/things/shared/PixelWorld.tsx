import { useEffect, useRef } from "react";

import {
  pixelWorldHash,
  pixelWorldTone,
  pixelWorldVariant,
  visiblePixelWorldPlayers,
  type PixelWorldGame,
  type PixelWorldPlayer,
  type PixelWorldRoom,
} from "./pixel-world";
import "./PixelWorld.css";

interface PixelPalette {
  background: string;
  foreground: string;
  stone100: string;
  stone200: string;
  stone300: string;
  stone400: string;
  stone500: string;
  amber: string;
  selection: string;
}

const WIDTH = 192;
const HEIGHT = 108;

function cssValue(styles: CSSStyleDeclaration, name: string) {
  return styles.getPropertyValue(name).trim();
}

function paletteFor(canvas: HTMLCanvasElement): PixelPalette {
  const styles = getComputedStyle(canvas);
  return {
    background: cssValue(styles, "--pixel-world-background"),
    foreground: cssValue(styles, "--pixel-world-foreground"),
    stone100: cssValue(styles, "--pixel-world-stone-100"),
    stone200: cssValue(styles, "--pixel-world-stone-200"),
    stone300: cssValue(styles, "--pixel-world-stone-300"),
    stone400: cssValue(styles, "--pixel-world-stone-400"),
    stone500: cssValue(styles, "--pixel-world-stone-500"),
    amber: cssValue(styles, "--pixel-world-amber"),
    selection: cssValue(styles, "--pixel-world-selection"),
  };
}

function rect(
  context: CanvasRenderingContext2D,
  colour: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.fillStyle = colour;
  context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function line(
  context: CanvasRenderingContext2D,
  colour: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  context.strokeStyle = colour;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  context.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
  context.stroke();
}

function drawFloor(context: CanvasRenderingContext2D, palette: PixelPalette, variant: number) {
  rect(context, palette.stone100, 0, 0, WIDTH, 66);
  rect(context, palette.stone200, 0, 66, WIDTH, HEIGHT - 66);
  line(context, palette.stone400, 0, 65, WIDTH, 65);
  for (let y = 70; y < HEIGHT; y += 8) {
    const offset = ((y - 70) / 8 + variant) % 2 === 0 ? 0 : 8;
    for (let x = -offset; x < WIDTH; x += 16) line(context, palette.stone300, x, y, x + 8, y + 4);
  }
  for (let x = 8 + variant * 3; x < WIDTH; x += 24) {
    line(context, palette.stone200, x, 0, x, 65);
  }
}

function drawWindow(context: CanvasRenderingContext2D, palette: PixelPalette, variant: number) {
  const x = variant % 2 === 0 ? 10 : 132;
  rect(context, palette.stone500, x, 9, 49, 27);
  rect(context, palette.selection, x + 2, 11, 45, 23);
  line(context, palette.stone500, x + 24, 11, x + 24, 34);
  line(context, palette.stone500, x + 2, 22, x + 47, 22);
  rect(context, palette.background, x + 7, 13, 4, 2);
  rect(context, palette.background, x + 36, 25, 6, 2);
}

function drawTable(
  context: CanvasRenderingContext2D,
  palette: PixelPalette,
  round: boolean,
  x = 72,
  y = 67,
) {
  if (round) {
    rect(context, palette.stone500, x + 5, y - 2, 39, 19);
    rect(context, palette.stone300, x + 2, y + 1, 45, 13);
    rect(context, palette.stone400, x + 21, y + 14, 7, 8);
    return;
  }
  rect(context, palette.stone500, x, y, 51, 4);
  rect(context, palette.stone300, x + 2, y - 3, 47, 5);
  rect(context, palette.stone400, x + 5, y + 4, 5, 14);
  rect(context, palette.stone400, x + 41, y + 4, 5, 14);
}

function drawGameFurniture(
  context: CanvasRenderingContext2D,
  palette: PixelPalette,
  game: PixelWorldGame,
  variant: number,
) {
  drawWindow(context, palette, variant);
  const mafia = game === "liars" || game === "mafia";
  drawTable(context, palette, mafia, variant === 2 ? 67 : 72, 67);

  if (game === "lost") {
    rect(context, palette.stone500, 137, 37, 40, 25);
    rect(context, palette.background, 139, 39, 36, 21);
    line(context, palette.amber, 143, 55, 151, 44);
    line(context, palette.amber, 151, 44, 160, 53);
    line(context, palette.amber, 160, 53, 170, 42);
    rect(context, palette.amber, 157, 49, 3, 3);
    return;
  }

  if (mafia) {
    rect(context, palette.stone500, 151, 39, 27, 22);
    rect(context, palette.background, 153, 41, 23, 18);
    rect(context, palette.amber, 158, 48, 3, 6);
    rect(context, palette.amber, 168, 46, 3, 8);
    return;
  }
  if (game === "imposter") {
    rect(context, palette.stone500, 148, 43, 28, 17);
    rect(context, palette.selection, 151, 46, 22, 11);
    rect(context, palette.amber, 160, 49, 4, 4);
    return;
  }
  if (game === "same-brain") {
    rect(context, palette.stone500, 145, 39, 34, 22);
    rect(context, palette.background, 147, 41, 30, 18);
    line(context, palette.amber, 151, 54, 158, 46);
    line(context, palette.amber, 158, 46, 165, 54);
    line(context, palette.amber, 165, 54, 173, 45);
    return;
  }
  if (game === "centre") {
    context.strokeStyle = palette.amber;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(161, 50, 10, 0, Math.PI * 1.75);
    context.stroke();
    rect(context, palette.amber, 159, 48, 4, 4);
    return;
  }
  if (game === "twin") {
    rect(context, palette.background, 149, 42, 13, 18);
    rect(context, palette.foreground, 151, 44, 9, 14);
    rect(context, palette.background, 165, 40, 13, 18);
    rect(context, palette.amber, 167, 42, 9, 14);
    rect(context, palette.selection, 155, 48, 3, 3);
    rect(context, palette.selection, 169, 46, 3, 3);
    return;
  }
  if (game === "draw-country") {
    line(context, palette.stone500, 151, 61, 160, 39);
    line(context, palette.stone500, 169, 61, 160, 39);
    rect(context, palette.background, 151, 42, 19, 14);
    rect(context, palette.amber, 154, 45, 4, 6);
    rect(context, palette.stone400, 160, 47, 7, 5);
    return;
  }
  rect(context, palette.amber, 153, 44, 18, 4);
  rect(context, palette.stone400, 150, 48, 24, 12);
}

function playerPosition(index: number, player: PixelWorldPlayer, time: number, seed: number) {
  const readySeats: ReadonlyArray<readonly [number, number]> = [
    [67, 58],
    [91, 54],
    [118, 58],
    [67, 82],
    [94, 85],
    [122, 82],
    [48, 76],
    [142, 77],
  ];
  if (player.entering) {
    const progress = Math.min(1, time / 900);
    return [18 + progress * 40, 86 - progress * 12] as const;
  }
  if (player.ready) return readySeats[index % readySeats.length] ?? readySeats[0]!;
  const phase = time / 1_200 + ((seed % 7) * Math.PI) / 3;
  return [28 + (seed % 25) + Math.round(Math.sin(phase) * 5), 78 + (seed % 8)] as const;
}

type LostGuestGesture = "none" | "map" | "shrug" | "think" | "question";

function lostGuestPose(time: number, motion: boolean) {
  if (!motion) return { x: 118, y: 68, walking: false, facing: 1, gesture: "map" as const };

  const cycle = time % 24_000;
  if (cycle < 2_200) {
    const progress = cycle / 2_200;
    return {
      x: 18 + progress * 100,
      y: 86 - progress * 18,
      walking: true,
      facing: 1,
      gesture: "none" as const,
    };
  }
  if (cycle < 5_600)
    return {
      x: 118,
      y: 68,
      walking: false,
      facing: 1,
      gesture: "map" as const,
    };
  if (cycle < 7_200)
    return {
      x: 118,
      y: 68,
      walking: false,
      facing: -1,
      gesture: "question" as const,
    };
  if (cycle < 10_000) {
    const progress = (cycle - 7_200) / 2_800;
    return {
      x: 118 - progress * 48,
      y: 68 + progress * 10,
      walking: true,
      facing: -1,
      gesture: "none" as const,
    };
  }
  if (cycle < 12_600)
    return {
      x: 70,
      y: 78,
      walking: false,
      facing: -1,
      gesture: "shrug" as const,
    };
  if (cycle < 15_300) {
    const progress = (cycle - 12_600) / 2_700;
    return {
      x: 70 + progress * 48,
      y: 78 - progress * 10,
      walking: true,
      facing: 1,
      gesture: "none" as const,
    };
  }
  if (cycle < 19_000)
    return {
      x: 118,
      y: 68,
      walking: false,
      facing: 1,
      gesture: "think" as const,
    };
  const progress = (cycle - 19_000) / 5_000;
  return {
    x: 118 - progress * 100,
    y: 68 + progress * 18,
    walking: true,
    facing: -1,
    gesture: "none" as const,
  };
}

function drawLostGuestGesture(
  context: CanvasRenderingContext2D,
  palette: PixelPalette,
  x: number,
  y: number,
  gesture: LostGuestGesture,
) {
  if (gesture === "map") {
    line(context, palette.selection, x + 12, y + 11, x + 18, y + 3);
    rect(context, palette.selection, x + 17, y + 1, 2, 3);
  } else if (gesture === "shrug") {
    line(context, palette.selection, x + 1, y + 10, x - 4, y + 6);
    line(context, palette.selection, x + 11, y + 10, x + 16, y + 6);
    rect(context, palette.amber, x + 5, y - 6, 3, 1);
    rect(context, palette.amber, x + 7, y - 5, 2, 3);
    rect(context, palette.amber, x + 7, y - 1, 1, 1);
  } else if (gesture === "think") {
    line(context, palette.selection, x + 12, y + 12, x + 9, y + 7);
    rect(context, palette.selection, x + 8, y + 6, 2, 2);
  } else if (gesture === "question") {
    rect(context, palette.amber, x + 5, y - 7, 4, 1);
    rect(context, palette.amber, x + 8, y - 6, 2, 3);
    rect(context, palette.amber, x + 7, y - 2, 1, 2);
    rect(context, palette.amber, x + 7, y + 1, 1, 1);
  }
}

function drawPerson(
  context: CanvasRenderingContext2D,
  palette: PixelPalette,
  player: PixelWorldPlayer,
  index: number,
  time: number,
  motion: boolean,
) {
  const seed = pixelWorldHash(player.id);
  const tone = pixelWorldTone(player.id);
  const colours = [
    palette.amber,
    palette.stone500,
    palette.foreground,
    palette.stone400,
    palette.selection,
    palette.stone300,
    palette.amber,
    palette.stone500,
  ];
  const lostGuest = player.id === "lost-guest-404";
  const lostPose = lostGuest ? lostGuestPose(time, motion) : null;
  const [x, y] = lostPose
    ? ([lostPose.x, lostPose.y] as const)
    : playerPosition(index, player, motion ? time : 900, seed);
  const bob = motion && player.ready ? Math.round(Math.sin(time / 420 + index) * 1) : 0;
  const walking = lostPose?.walking ?? (motion && (!player.ready || player.entering));
  const step = walking && Math.floor(time / 180 + index) % 2 === 0 ? 1 : 0;
  const headShift = lostPose && !walking ? Math.round(Math.sin(time / 650) * 1) : 0;
  const shirt = colours[tone] ?? palette.foreground;
  rect(context, palette.foreground, x + 2 - step, y + 15 + bob, 3, 4);
  rect(context, palette.foreground, x + 8 + step, y + 15 + bob, 3, 4);
  rect(context, shirt, x + 1, y + 8 + bob, 11, 8);
  rect(context, palette.selection, x + 3 + headShift, y + 3 + bob, 7, 6);
  rect(
    context,
    tone % 2 === 0 ? palette.foreground : palette.stone500,
    x + 2 + headShift,
    y + 1 + bob,
    9,
    4,
  );
  const eyeShift = lostPose?.facing === -1 ? -1 : lostPose?.facing === 1 ? 1 : 0;
  rect(context, palette.foreground, x + 4 + headShift + eyeShift, y + 5 + bob, 1, 1);
  rect(context, palette.foreground, x + 8 + headShift + eyeShift, y + 5 + bob, 1, 1);
  rect(context, palette.selection, x - step, y + 9 + bob, 2, 5);
  rect(context, palette.selection, x + 11 + step, y + 9 + bob, 2, 5);
  if (player.lead) {
    rect(context, palette.amber, x + 10, y - 2 + bob, 3, 2);
    rect(context, palette.amber, x + 12, y - 1 + bob, 1, 5);
  }
  if (lostPose) drawLostGuestGesture(context, palette, x, y, lostPose.gesture);
}

function drawRoom(
  context: CanvasRenderingContext2D,
  palette: PixelPalette,
  room: PixelWorldRoom,
  elapsed: number,
  motion: boolean,
) {
  const variant = room.variant ?? pixelWorldVariant(room.roomId);
  drawFloor(context, palette, variant);
  drawGameFurniture(context, palette, room.game, variant);
  rect(context, palette.stone500, 5, 46, 25, 38);
  rect(context, palette.stone300, 8, 49, 19, 35);
  rect(context, palette.amber, 23, 66, 2, 2);

  if (room.status === "next") {
    rect(context, palette.background, 61, 77, 71, 1);
    for (let x = 64; x < 130; x += 8) rect(context, palette.stone400, x, 77, 4, 1);
    visiblePixelWorldPlayers(room.players).forEach((player, index) =>
      drawPerson(context, palette, player, index, elapsed, motion),
    );
    return;
  }

  visiblePixelWorldPlayers(room.players).forEach((player, index) =>
    drawPerson(context, palette, player, index, elapsed, motion),
  );

  if (room.status === "playing") {
    for (let y = 30; y < 90; y += 5) rect(context, palette.stone500, 35, y, 108, 2);
    rect(context, palette.amber, 83, 54, 12, 3);
  }
}

function paint(canvas: HTMLCanvasElement, room: PixelWorldRoom, elapsed: number, motion: boolean) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.imageSmoothingEnabled = false;
  context.setTransform(width / WIDTH, 0, 0, height / HEIGHT, 0, 0);
  context.clearRect(0, 0, WIDTH, HEIGHT);
  drawRoom(context, paletteFor(canvas), room, elapsed, motion);
}

export function PixelWorld({
  className = "",
  decorative = false,
  label,
  room,
  tone = "page",
}: {
  className?: string;
  decorative?: boolean;
  label: string;
  room: PixelWorldRoom;
  tone?: "page" | "night";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let frame = 0;
    let startedAt = performance.now();
    let lastPaint = 0;

    const render = (now: number) => {
      if (visible && (now - lastPaint >= 100 || reduced.matches)) {
        paint(canvas, room, now - startedAt, !reduced.matches);
        lastPaint = now;
      }
      if (!reduced.matches) frame = window.requestAnimationFrame(render);
    };
    const redraw = () => {
      startedAt = performance.now();
      paint(canvas, room, reduced.matches ? 900 : 0, !reduced.matches);
    };
    const resize = new ResizeObserver(redraw);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) redraw();
    });
    const motionChange = () => {
      window.cancelAnimationFrame(frame);
      redraw();
      if (!reduced.matches) frame = window.requestAnimationFrame(render);
    };

    resize.observe(canvas);
    intersection.observe(canvas);
    reduced.addEventListener("change", motionChange);
    redraw();
    if (!reduced.matches) frame = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      reduced.removeEventListener("change", motionChange);
    };
  }, [room]);

  return (
    <canvas
      ref={canvasRef}
      className={`pixel-world pixel-world--${tone} ${className}`}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
    />
  );
}

export function PixelRoomLobby({
  game,
  players,
  roomId,
  tone = "page",
}: {
  game: PixelWorldGame;
  players: PixelWorldPlayer[];
  roomId: string;
  tone?: "page" | "night";
}) {
  const present = players.filter(({ left }) => !left);
  const ready = present.filter((player) => player.ready).length;
  return (
    <section className="pixel-room-lobby" aria-labelledby={`pixel-room-${roomId}`}>
      <div className="pixel-room-lobby-heading">
        <div>
          <h2 id={`pixel-room-${roomId}`} className="pixel-room-lobby-title">
            the room
          </h2>
          <p className="pixel-room-lobby-status">
            {ready} of {present.length} ready
          </p>
        </div>
        <span className="pixel-room-lobby-key" aria-hidden="true">
          room life
        </span>
      </div>
      <PixelWorld
        room={{ game, roomId, status: "waiting", players: present, capacity: present.length }}
        label={`${ready} of ${present.length} players are ready in the room`}
        tone={tone}
      />
    </section>
  );
}

export function MultiplayerLobbyPanel({
  canPassLead,
  currentPlayerId,
  game,
  onPassLead,
  onRename,
  players,
  roomId,
  tone = "page",
}: {
  canPassLead: boolean;
  currentPlayerId: string | null;
  game: PixelWorldGame;
  onPassLead: (playerId: string) => void;
  onRename: () => void;
  players: PixelWorldPlayer[];
  roomId: string;
  tone?: "page" | "night";
}) {
  const present = players.filter(({ left }) => !left);
  return (
    <section className={`multiplayer-lobby-panel multiplayer-lobby-panel--${tone}`}>
      <PixelRoomLobby game={game} players={present} roomId={roomId} tone={tone} />
      <h3 className="multiplayer-lobby-panel-heading">who is here · {present.length}</h3>
      <ul className="multiplayer-lobby-roster" aria-label="Players in the room">
        {present.map((player) => (
          <li key={player.id}>
            <span>
              {player.name ?? "guest"}
              {player.id === currentPlayerId ? " · you" : ""}
              {player.lead ? " · room lead" : ""}
            </span>
            <span>{player.ready ? "ready" : "not ready"}</span>
            {canPassLead && !player.lead ? (
              <button type="button" onClick={() => onPassLead(player.id)}>
                make lead
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <button type="button" className="multiplayer-lobby-rename" onClick={onRename}>
        change my name
      </button>
    </section>
  );
}
