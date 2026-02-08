export function getPriorityPillClass(priority: string): string {
  switch (priority) {
    case "P0":
      return "fix-pill-p0";
    case "P1":
      return "fix-pill-p1";
    case "P2":
      return "fix-pill-p2";
    case "P3":
      return "fix-pill-p3";
    default:
      return "fix-pill-default";
  }
}

export function getPriorityRank(priority: string): number {
  switch (priority) {
    case "P0":
      return 0;
    case "P1":
      return 1;
    case "P2":
      return 2;
    case "P3":
      return 3;
    default:
      return 99;
  }
}
