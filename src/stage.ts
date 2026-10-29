import { freeze, type Plan, type Stage } from "./model";
export const stage: Stage = freeze({
  id: "relay-room-v1",
  title: "01 / ふたつの合図",
  rows: [
    "###########",
    "#....#....#",
    "#....#....#",
    "#.........#",
    "#....#....#",
    "#....#....#",
    "#....#....#",
    "###########",
  ],
  people: [
    { id: "A", name: "アオ", x: 2, y: 3, color: 0x75d5ef },
    { id: "B", name: "ベニ", x: 2, y: 5, color: 0xf3b479 },
  ],
  switches: [
    { id: "s1", name: "スイッチ S1", x: 2, y: 2 },
    { id: "s2", name: "スイッチ S2", x: 2, y: 6 },
  ],
  doors: [
    {
      id: "gate",
      name: "中央ゲート",
      x: 5,
      y: 3,
      switches: ["s1", "s2"],
      mode: "all",
      delay: 0,
      duration: 6,
    },
  ],
  exits: [{ x: 8, y: 3 }],
  boxes: [],
});
export const solution: Plan = freeze({
  A: [
    { kind: "interact", target: "s1" },
    { kind: "go", x: 8, y: 3 },
  ],
  B: [
    { kind: "interact", target: "s2" },
    { kind: "move", direction: "right", count: 2 },
    { kind: "move", direction: "up", count: 2 },
    { kind: "go", x: 8, y: 3 },
  ],
});
export const collisionExample: Plan = freeze({
  A: [{ kind: "move", direction: "down", count: 1 }],
  B: [{ kind: "move", direction: "up", count: 1 }],
});
