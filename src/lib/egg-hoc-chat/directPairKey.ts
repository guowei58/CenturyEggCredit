/** Stable key for a two-user direct conversation (order-independent). */
export function makeDirectPairKey(userIdA: string, userIdB: string): string {
  const a = userIdA.trim();
  const b = userIdB.trim();
  if (a === b) throw new Error("Cannot create a direct conversation with yourself");
  return [a, b].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)).join("::");
}
