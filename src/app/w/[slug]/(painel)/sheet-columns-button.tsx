"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, inputClass } from "@/components/ui";
import { answerLabel, type SheetColumn } from "@/lib/sheet-columns";
import { saveSheetColumns } from "../actions";
import { BottomSheet } from "./bottom-sheet";
import { usePanel } from "./panel-context";

/** Admin only: rename, hide, reorder and add columns of the sheet. */
export function SheetColumnsButton() {
  const { isAdmin } = usePanel();
  const [open, setOpen] = useState(false);
  if (!isAdmin) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Colunas
      </Button>
      {open && <ColumnsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ColumnsDialog({ onClose }: { onClose: () => void }) {
  const { slug, columns: initial, answers } = usePanel();
  const router = useRouter();
  const [columns, setColumns] = useState<SheetColumn[]>(initial);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const leadsOf = (key: string) => answers.find((a) => a.key === key)?.leads;

  const data = columns.filter((c) => c.kind !== "fixed");
  const fixed = columns.filter((c) => c.kind === "fixed");
  const update = (key: string, change: Partial<SheetColumn>) =>
    setColumns((all) => all.map((c) => (c.key === key ? { ...c, ...change } : c)));
  const move = (key: string, step: -1 | 1) =>
    setColumns((all) => {
      const list = all.filter((c) => c.kind !== "fixed");
      const i = list.findIndex((c) => c.key === key);
      const j = i + step;
      if (i < 0 || j < 0 || j >= list.length) return all;
      [list[i], list[j]] = [list[j], list[i]];
      return [...list, ...all.filter((c) => c.kind === "fixed")];
    });
  const add = () => {
    const name = newName.trim().slice(0, 120);
    if (!name) return;
    if (columns.some((c) => c.key.toLowerCase() === name.toLowerCase() || c.label.toLowerCase() === name.toLowerCase())) {
      setError("Já existe uma coluna com esse nome.");
      return;
    }
    setError(null);
    setColumns((all) => [...all.filter((c) => c.kind !== "fixed"), { key: name, label: name, kind: "custom", hidden: false }, ...all.filter((c) => c.kind === "fixed")]);
    setNewName("");
  };
  const save = () =>
    start(async () => {
      const result = await saveSheetColumns(slug, columns);
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });

  return (
    <BottomSheet title="Colunas da planilha" onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <section className="flex flex-col gap-2">
          <div>
            <h3 className="font-medium">Respostas e colunas próprias</h3>
            <p className="text-xs text-zinc-500">
              Cada resposta do formulário, quiz ou planilha vira uma coluna. Renomeie, oculte ou mude a ordem. Respostas novas aparecem
              sozinhas no fim.
            </p>
          </div>
          {data.length === 0 && <p className="text-xs text-zinc-500">Nenhuma resposta recebida ainda.</p>}
          <ul className="flex flex-col gap-2">
            {data.map((c, i) => (
              <li key={c.key} className={`rounded-md border border-zinc-200 p-2 ${c.hidden ? "bg-zinc-50" : ""}`}>
                <div className="flex items-center gap-1">
                  <input
                    value={c.label}
                    maxLength={120}
                    aria-label={`Nome da coluna ${c.key}`}
                    onChange={(e) => update(c.key, { label: e.target.value })}
                    className={`${inputClass} ${c.hidden ? "text-zinc-400" : ""}`}
                  />
                  <button type="button" className="px-1.5 py-1 text-zinc-500 disabled:opacity-30" disabled={i === 0} onClick={() => move(c.key, -1)} aria-label="Subir">
                    ↑
                  </button>
                  <button
                    type="button"
                    className="px-1.5 py-1 text-zinc-500 disabled:opacity-30"
                    disabled={i === data.length - 1}
                    onClick={() => move(c.key, 1)}
                    aria-label="Descer"
                  >
                    ↓
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                  <span className="min-w-0 truncate">
                    {c.kind === "custom"
                      ? "Coluna própria: o atendente preenche"
                      : `Resposta${leadsOf(c.key) ? ` · ${leadsOf(c.key)} leads` : ""}${c.label !== answerLabel(c.key) ? ` · original: ${answerLabel(c.key)}` : ""}`}
                  </span>
                  <span className="flex items-center gap-3">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={!c.hidden} onChange={(e) => update(c.key, { hidden: !e.target.checked })} />
                      Mostrar
                    </label>
                    {c.kind === "custom" && (
                      <button
                        type="button"
                        className="text-red-700 hover:underline"
                        onClick={() => setColumns((all) => all.filter((x) => x.key !== c.key))}
                      >
                        Remover
                      </button>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              value={newName}
              maxLength={120}
              placeholder="Nova coluna (ex.: Bairro, Renda)"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              className={inputClass}
            />
            <Button variant="secondary" onClick={add} disabled={!newName.trim()}>
              Adicionar
            </Button>
          </div>
          <p className="text-xs text-zinc-500">Remover uma coluna própria só a tira da planilha; o que já foi preenchido continua na exportação.</p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-medium">Colunas padrão</h3>
          <div className="grid grid-cols-2 gap-1">
            {fixed.map((c) => (
              <label key={c.key} className="flex items-center gap-2">
                <input type="checkbox" checked={!c.hidden} onChange={(e) => update(c.key, { hidden: !e.target.checked })} />
                {c.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-zinc-500">Nome, telefone, status, retorno e valor sempre aparecem.</p>
        </section>

        {error && <p className="text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Salvando..." : "Salvar colunas"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
