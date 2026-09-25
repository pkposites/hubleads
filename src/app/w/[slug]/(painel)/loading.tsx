/** Shown at once when switching tabs, while the server prepares the page. */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-busy="true" aria-label="Carregando">
      <div className="grid grid-cols-3 gap-2 md:max-w-2xl">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-zinc-200/70" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-40 rounded-lg bg-zinc-200/60" />
      ))}
    </div>
  );
}
