/** HTML datetime-local values have no timezone. Never let the browser choose one implicitly. */
export function toZonedDateTimeInput(iso: string | undefined | null, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error("Enter a valid date and time.");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

export function fromZonedDateTimeInput(value: string, timeZone: string): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Enter a valid date and time.");
  const wallTime = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wallTime)) throw new Error("Enter a valid date and time.");
  // Sampling both sides of a DST transition discovers both possible offsets. A gap or fold must
  // be resolved deliberately, rather than silently moving an event or scheduled message.
  const matches = new Set<string>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = wallTime + hours * 3_600_000;
    const local = toZonedDateTimeInput(new Date(probe).toISOString(), timeZone);
    const offset = Date.parse(`${local}:00Z`) - probe;
    const candidate = new Date(wallTime - offset).toISOString();
    if (toZonedDateTimeInput(candidate, timeZone) === value) matches.add(candidate);
  }
  if (matches.size !== 1) {
    throw new Error(
      matches.size === 0
        ? `That time does not exist in ${timeZone}. Choose a time outside the clock change.`
        : `That time occurs twice in ${timeZone}. Choose an unambiguous time outside the clock change.`,
    );
  }
  return [...matches][0];
}
