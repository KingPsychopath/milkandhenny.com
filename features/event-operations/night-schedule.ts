const formatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

function parts(value: string | number | Date, timeZone: string) {
  return Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function isoToEventLocalInput(value: string | undefined, timeZone: string) {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  const local = parts(value, timeZone);
  return `${local.year}-${local.month}-${local.day}T${local.hour}:${local.minute}`;
}

function offsetAt(timestamp: number, timeZone: string) {
  const local = parts(timestamp, timeZone);
  const representedAsUtc = Date.UTC(
    Number(local.year),
    Number(local.month) - 1,
    Number(local.day),
    Number(local.hour),
    Number(local.minute),
    Number(local.second),
  );
  return representedAsUtc - Math.floor(timestamp / 1_000) * 1_000;
}

export function eventLocalInputToIso(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a complete date and time");
  const wallClock = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  const first = wallClock - offsetAt(wallClock, timeZone);
  const instant = wallClock - offsetAt(first, timeZone);
  const iso = new Date(instant).toISOString();
  if (isoToEventLocalInput(iso, timeZone) !== value) {
    throw new Error(`That local time does not exist in ${timeZone}`);
  }
  return iso;
}
