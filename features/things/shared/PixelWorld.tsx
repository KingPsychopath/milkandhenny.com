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
  const positions = [10, 132, 18, 124, 72, 136] as const;
  const x = positions[variant % positions.length] ?? 10;
  rect(context, palette.stone500, x, 9, 49, 27);
  rect(context, palette.selection, x + 2, 11, 45, 23);
  line(context, palette.stone500, x + 24, 11, x + 24, 34);
  line(context, palette.stone500, x + 2, 22, x + 47, 22);
  rect(context, palette.background, x + 7, 13, 4, 2);
  rect(context, palette.background, x + 36, 25, 6, 2);
}

function drawBookcase(
  context: CanvasRenderingContext2D,
  palette: PixelPalette,
  x: number,
  y: number,
) {
  rect(context, palette.stone500, x, y, 25, 25);
  rect(context, palette.background, x + 2, y + 2, 21, 21);
  line(context, palette.stone500, x + 2, y + 11, x + 23, y + 11);
  rect(context, palette.amber, x + 5, y + 4, 2, 7);
  rect(context, palette.stone400, x + 9, y + 3, 3, 8);
  rect(context, palette.selection, x + 15, y + 5, 4, 6);
  rect(context, palette.stone300, x + 4, y + 15, 5, 8);
  rect(context, palette.amber, x + 12, y + 14, 3, 9);
  rect(context, palette.stone400, x + 18, y + 16, 2, 7);
}

function drawLamp(context: CanvasRenderingContext2D, palette: PixelPalette, x: number, y: number) {
  rect(context, palette.stone500, x + 6, y + 7, 1, 16);
  rect(context, palette.stone500, x + 2, y + 23, 9, 2);
  rect(context, palette.amber, x + 2, y + 2, 9, 6);
  rect(context, palette.selection, x + 4, y + 4, 5, 3);
}

function drawNoticeboard(
  context: CanvasRenderingContext2D,
  palette: PixelPalette,
  x: number,
  y: number,
  pins: number,
) {
  rect(context, palette.stone500, x, y, 31, 22);
  rect(context, palette.background, x + 2, y + 2, 27, 18);
  for (let index = 0; index < pins; index += 1) {
    const noteX = x + 5 + (index % 3) * 8;
    const noteY = y + 5 + Math.floor(index / 3) * 8;
    rect(context, index % 2 === 0 ? palette.selection : palette.stone300, noteX, noteY, 5, 5);
    rect(context, palette.amber, noteX + 2, noteY - 1, 1, 1);
  }
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
  const tableX = [72, 64, 78, 68, 60, 75][variant % 6] ?? 72;
  const tableY = [67, 70, 65, 68, 66, 71][variant % 6] ?? 67;
  drawTable(context, palette, mafia, tableX, tableY);

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
    if (variant % 3 === 0) drawNoticeboard(context, palette, 147, 38, 4);
    else if (variant % 3 === 1) {
      drawBookcase(context, palette, 150, 36);
      drawLamp(context, palette, 135, 39);
    } else {
      drawLamp(context, palette, 151, 37);
      rect(context, palette.stone500, 171, 43, 8, 17);
      rect(context, palette.background, 173, 45, 4, 13);
      rect(context, palette.amber, 174, 47, 2, 2);
    }
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

type CharacterGesture =
  | "none"
  | "map"
  | "shrug"
  | "think"
  | "question"
  | "wave"
  | "clipboard"
  | "arrange";

interface CharacterPose {
  x: number;
  y: number;
  walking: boolean;
  facing: -1 | 1;
  gesture: CharacterGesture;
}

const READY_SEATS: ReadonlyArray<readonly [number, number]> = [
  [67, 58],
  [91, 54],
  [118, 58],
  [67, 82],
  [94, 85],
  [122, 82],
  [48, 76],
  [142, 77],
];

function between(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function lostGuestPose(time: number, motion: boolean): CharacterPose {
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

function conciergePose(time: number, motion: boolean): CharacterPose {
  if (!motion) return { x: 126, y: 70, walking: false, facing: -1, gesture: "clipboard" };

  const cycle = time % 20_000;
  if (cycle < 3_000) {
    const progress = cycle / 3_000;
    return {
      x: between(24, 69, progress),
      y: between(83, 76, progress),
      walking: true,
      facing: 1,
      gesture: "none",
    };
  }
  if (cycle < 6_500) return { x: 69, y: 76, walking: false, facing: 1, gesture: "arrange" };
  if (cycle < 9_500) {
    const progress = (cycle - 6_500) / 3_000;
    return {
      x: between(69, 126, progress),
      y: between(76, 70, progress),
      walking: true,
      facing: 1,
      gesture: "none",
    };
  }
  if (cycle < 14_000) return { x: 126, y: 70, walking: false, facing: -1, gesture: "clipboard" };
  if (cycle < 18_000) {
    const progress = (cycle - 14_000) / 4_000;
    return {
      x: between(126, 40, progress),
      y: between(70, 81, progress),
      walking: true,
      facing: -1,
      gesture: "none",
    };
  }
  return { x: 40, y: 81, walking: false, facing: 1, gesture: "wave" };
}

function arrangerPose(time: number, motion: boolean): CharacterPose {
  if (!motion) return { x: 69, y: 76, walking: false, facing: 1, gesture: "arrange" };

  const cycle = time % 18_000;
  if (cycle < 2_500) {
    const progress = cycle / 2_500;
    return {
      x: between(35, 69, progress),
      y: between(82, 76, progress),
      walking: true,
      facing: 1,
      gesture: "none",
    };
  }
  if (cycle < 6_000) return { x: 69, y: 76, walking: false, facing: 1, gesture: "arrange" };
  if (cycle < 9_000) {
    const progress = (cycle - 6_000) / 3_000;
    return {
      x: between(69, 116, progress),
      y: between(76, 74, progress),
      walking: true,
      facing: 1,
      gesture: "none",
    };
  }
  if (cycle < 13_000) return { x: 116, y: 74, walking: false, facing: -1, gesture: "arrange" };
  if (cycle < 16_000) {
    const progress = (cycle - 13_000) / 3_000;
    return {
      x: between(116, 35, progress),
      y: between(74, 82, progress),
      walking: true,
      facing: -1,
      gesture: "none",
    };
  }
  return { x: 35, y: 82, walking: false, facing: 1, gesture: "think" };
}

function passerbyPose(time: number, motion: boolean, seed: number): CharacterPose {
  if (!motion) return { x: 92, y: 76, walking: false, facing: 1, gesture: "wave" };

  const performance = seed % 3;
  const cycle = Math.min(time, 12_000);
  if (performance === 1) {
    if (cycle < 2_600) {
      const progress = cycle / 2_600;
      return {
        x: between(18, 107, progress),
        y: between(85, 72, progress),
        walking: true,
        facing: 1,
        gesture: "none",
      };
    }
    if (cycle < 6_400) return { x: 107, y: 72, walking: false, facing: 1, gesture: "think" };
    if (cycle < 8_000) return { x: 107, y: 72, walking: false, facing: -1, gesture: "shrug" };
    const progress = (cycle - 8_000) / 4_000;
    return {
      x: between(107, 184, progress),
      y: between(72, 84, progress),
      walking: true,
      facing: 1,
      gesture: "none",
    };
  }
  if (performance === 2) {
    if (cycle < 3_800) {
      const progress = cycle / 3_800;
      return {
        x: between(182, 87, progress),
        y: between(84, 75, progress),
        walking: true,
        facing: -1,
        gesture: "none",
      };
    }
    if (cycle < 7_000) return { x: 87, y: 75, walking: false, facing: -1, gesture: "map" };
    if (cycle < 8_500) return { x: 87, y: 75, walking: false, facing: 1, gesture: "wave" };
    const progress = (cycle - 8_500) / 3_500;
    return {
      x: between(87, 18, progress),
      y: between(75, 86, progress),
      walking: true,
      facing: -1,
      gesture: "none",
    };
  }
  if (cycle < 3_200) {
    const progress = cycle / 3_200;
    return {
      x: between(17, 77, progress),
      y: between(86, 77, progress),
      walking: true,
      facing: 1,
      gesture: "none",
    };
  }
  if (cycle < 5_200) return { x: 77, y: 77, walking: false, facing: 1, gesture: "wave" };
  const progress = (cycle - 5_200) / 6_800;
  return {
    x: between(77, 184, progress),
    y: between(77, 84, progress),
    walking: true,
    facing: 1,
    gesture: "none",
  };
}

function gameIdleGesture(game: PixelWorldGame, seed: number): CharacterGesture {
  if (game === "draw-country") return "map";
  if (game === "same-brain" || game === "centre") return "think";
  if (game === "liars" || game === "mafia")
    return (["question", "think", "shrug"] as const)[seed % 3] ?? "question";
  if (game === "imposter") return seed % 2 === 0 ? "question" : "shrug";
  return "wave";
}

function playerPose(
  game: PixelWorldGame,
  index: number,
  player: PixelWorldPlayer,
  time: number,
  motion: boolean,
  seed: number,
): CharacterPose {
  if (player.entering) {
    const progress = Math.min(1, (motion ? time : 900) / 900);
    return {
      x: between(18, 58, progress),
      y: between(86, 74, progress),
      walking: motion && progress < 1,
      facing: 1,
      gesture: "none",
    };
  }

  if (player.ready) {
    const socialDeduction = game === "liars" || game === "mafia" || game === "imposter";
    const socialSeats: typeof READY_SEATS = [
      [61, 57],
      [86, 52],
      [116, 56],
      [133, 71],
      [116, 85],
      [86, 88],
      [58, 83],
      [46, 70],
    ];
    const seats = socialDeduction ? socialSeats : READY_SEATS;
    const [x, y] = seats[index % seats.length] ?? seats[0]!;
    const cycle = motion ? (time + index * 2_300 + (seed % 1_200)) % 14_000 : 0;
    const active = motion && cycle >= 7_500 && cycle < 9_200;
    return {
      x,
      y,
      walking: false,
      facing: index % 3 === 0 ? 1 : -1,
      gesture: active ? (player.lead ? "clipboard" : gameIdleGesture(game, seed)) : "none",
    };
  }

  const homeX = 35 + (seed % 34);
  const awayX = 82 + (seed % 42);
  const y = 73 + (seed % 11);
  if (!motion)
    return { x: homeX, y, walking: false, facing: 1, gesture: player.lead ? "clipboard" : "none" };

  const cycle = (time + (seed % 5_000)) % 16_000;
  if (cycle < 3_500) {
    const progress = cycle / 3_500;
    return {
      x: between(homeX, awayX, progress),
      y: y - Math.sin(progress * Math.PI) * 4,
      walking: true,
      facing: 1,
      gesture: "none",
    };
  }
  if (cycle < 8_000)
    return {
      x: awayX,
      y: y - 1,
      walking: false,
      facing: -1,
      gesture:
        cycle >= 5_500 && cycle < 7_000
          ? player.lead
            ? "clipboard"
            : gameIdleGesture(game, seed)
          : "none",
    };
  if (cycle < 11_500) {
    const progress = (cycle - 8_000) / 3_500;
    return {
      x: between(awayX, homeX, progress),
      y: y - 1 + Math.sin(progress * Math.PI) * 4,
      walking: true,
      facing: -1,
      gesture: "none",
    };
  }
  return { x: homeX, y, walking: false, facing: 1, gesture: "none" };
}

function characterPose(
  game: PixelWorldGame,
  index: number,
  player: PixelWorldPlayer,
  time: number,
  motion: boolean,
  seed: number,
) {
  if (player.role === "lost-guest") return lostGuestPose(time, motion);
  if (player.role === "concierge") return conciergePose(time, motion);
  if (player.role === "arranger") return arrangerPose(time, motion);
  if (player.role === "passerby") return passerbyPose(time, motion, seed);
  return playerPose(game, index, player, time, motion, seed);
}

function drawCharacterGesture(
  context: CanvasRenderingContext2D,
  palette: PixelPalette,
  x: number,
  y: number,
  gesture: CharacterGesture,
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
  } else if (gesture === "wave") {
    line(context, palette.selection, x + 12, y + 11, x + 15, y + 4);
    rect(context, palette.selection, x + 14, y + 2, 2, 3);
  } else if (gesture === "clipboard") {
    rect(context, palette.stone500, x + 11, y + 8, 6, 8);
    rect(context, palette.background, x + 12, y + 9, 4, 5);
    rect(context, palette.amber, x + 13, y + 8, 2, 1);
  } else if (gesture === "arrange") {
    line(context, palette.selection, x + 1, y + 11, x - 2, y + 16);
    line(context, palette.selection, x + 11, y + 11, x + 15, y + 16);
  }
}

function drawPerson(
  context: CanvasRenderingContext2D,
  palette: PixelPalette,
  player: PixelWorldPlayer,
  index: number,
  time: number,
  motion: boolean,
  game: PixelWorldGame,
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
  const pose = characterPose(game, index, player, time, motion, seed);
  const { x, y, walking } = pose;
  const bob = 0;
  const step = walking && Math.floor(time / 180 + index) % 2 === 0 ? 1 : 0;
  const headShift =
    motion && !walking && pose.gesture !== "none"
      ? Math.round(Math.sin(time / 1_100 + index) * 1)
      : 0;
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
  const eyeShift = pose.facing;
  rect(context, palette.foreground, x + 4 + headShift + eyeShift, y + 5 + bob, 1, 1);
  rect(context, palette.foreground, x + 8 + headShift + eyeShift, y + 5 + bob, 1, 1);
  rect(context, palette.selection, x - step, y + 9 + bob, 2, 5);
  rect(context, palette.selection, x + 11 + step, y + 9 + bob, 2, 5);
  if (player.lead) {
    rect(context, palette.amber, x + 10, y - 2 + bob, 3, 2);
    rect(context, palette.amber, x + 12, y - 1 + bob, 1, 5);
  }
  drawCharacterGesture(context, palette, x, y, pose.gesture);
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
      drawPerson(context, palette, player, index, elapsed, motion, room.game),
    );
    return;
  }

  visiblePixelWorldPlayers(room.players).forEach((player, index) =>
    drawPerson(context, palette, player, index, elapsed, motion, room.game),
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
  const roomRef = useRef(room);
  const redrawRef = useRef<(() => void) | null>(null);
  roomRef.current = room;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let intersecting = true;
    let frame = 0;
    let timer = 0;
    const startedAt = performance.now();
    const canAnimate = () =>
      intersecting && document.visibilityState === "visible" && !reduced.matches;

    const render = (now: number) => {
      frame = 0;
      timer = 0;
      if (!canAnimate()) return;
      paint(canvas, roomRef.current, now - startedAt, true);
      timer = window.setTimeout(() => {
        if (canAnimate()) frame = window.requestAnimationFrame(render);
      }, 100);
    };
    const redraw = () => {
      paint(
        canvas,
        roomRef.current,
        reduced.matches ? 900 : performance.now() - startedAt,
        !reduced.matches,
      );
    };
    const stop = () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      frame = 0;
      timer = 0;
    };
    const start = () => {
      if (!frame && !timer && canAnimate()) frame = window.requestAnimationFrame(render);
    };
    const resize = new ResizeObserver(redraw);
    const intersection = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? true;
      if (intersecting) {
        redraw();
        start();
      } else stop();
    });
    const motionChange = () => {
      stop();
      redraw();
      start();
    };
    const visibilityChange = () => {
      stop();
      if (document.visibilityState === "visible") {
        redraw();
        start();
      }
    };

    redrawRef.current = redraw;
    resize.observe(canvas);
    intersection.observe(canvas);
    reduced.addEventListener("change", motionChange);
    document.addEventListener("visibilitychange", visibilityChange);
    redraw();
    start();
    return () => {
      redrawRef.current = null;
      stop();
      resize.disconnect();
      intersection.disconnect();
      reduced.removeEventListener("change", motionChange);
      document.removeEventListener("visibilitychange", visibilityChange);
    };
  }, []);

  useEffect(() => {
    redrawRef.current?.();
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
