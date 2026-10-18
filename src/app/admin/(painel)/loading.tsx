/** Shown at once when switching pages, while the server prepares the next one. */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-busy="true" aria-label="Carregando">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-zinc-200/70" />
        ))}
      </div>
      <div className="h-6 w-32 rounded bg-zinc-200/70" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 rounded-xl bg-zinc-200/60" />
      ))}
    </div>
  );
}
