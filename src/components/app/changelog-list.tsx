import type { ChangelogEntry } from "@/lib/changelog";

export function ChangelogList({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry) => (
        <li key={entry.version} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">
              v{entry.version} · {entry.title}
            </h3>
            <time dateTime={entry.date} className="shrink-0 text-xs text-muted-foreground">
              {entry.date}
            </time>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {entry.highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
