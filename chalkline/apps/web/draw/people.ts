/** Someone in a board's room, as GET /people/:roomId lists them. */
export type Person = { id: string; username: string; avatar: string; shapes: number };

/**
 * Who to show, most shapes first: everyone who drew something, plus anyone
 * online who has not drawn yet. Ties go to whoever is online, then by name, so
 * the order does not shuffle between loads.
 */
export function rankPeople(people: Person[], online: ReadonlySet<string>): Person[] {
  return people
    .filter((p) => p.shapes > 0 || online.has(p.id))
    .sort(
      (a, b) =>
        b.shapes - a.shapes ||
        Number(online.has(b.id)) - Number(online.has(a.id)) ||
        a.username.localeCompare(b.username)
    );
}
