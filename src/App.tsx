import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import referenceLbr from '../fixtures/lbr/reference.lbr?raw';
import './App.css';
import { ConflictDialog } from './components/ConflictDialog.tsx';
import { LibraryTable } from './components/LibraryTable.tsx';
import { PartCard } from './components/PartCard.tsx';
import { RemoveDialog } from './components/RemoveDialog.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { Toasts, type ToastMessage } from './components/Toast.tsx';
import { DEFAULT_CATEGORIES, suggestCategory, type Category } from './core/categories.ts';
import { convertPart, type ConvertedPart } from './core/eagle/convert.ts';
import { EasyEdaError } from './core/easyeda/errors.ts';
import type { PartSvgs } from './core/easyeda/fetch.ts';
import type { PartModel } from './core/easyeda/types.ts';
import { createEmptyLibrary, parseLbr, serializeLbr, summariseDevicesets, type DevicesetSummary } from './core/lbr/document.ts';
import { applyMerge, planMerge, type MergePlan, type Resolution } from './core/lbr/merge.ts';
import { applyRemoval, planRemoval, type RemovalPlan } from './core/lbr/remove.ts';
import { saveLbrSafely } from './core/lbr/save.ts';
import { easyEda, pickLibraryToCreate, pickLibraryToOpen, tauriFs } from './tauri/adapters.ts';
import { loadSettings, saveSettings } from './tauri/settings.ts';

interface Library {
  path: string;
  text: string;
  devicesets: DevicesetSummary[];
}

function describeError(e: unknown): string {
  if (e instanceof EasyEdaError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export default function App() {
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [library, setLibrary] = useState<Library | null>(null);
  const [partInput, setPartInput] = useState('');
  const [fetching, setFetching] = useState(false);
  const [model, setModel] = useState<PartModel | null>(null);
  const [svgs, setSvgs] = useState<PartSvgs | null>(null);
  const [categoryId, setCategoryId] = useState<string>(DEFAULT_CATEGORIES[0].id);
  const [adding, setAdding] = useState(false);
  const [conflictPlan, setConflictPlan] = useState<MergePlan | null>(null);
  const [removal, setRemoval] = useState<RemovalPlan | null>(null);
  const [removing, setRemoving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((kind: ToastMessage['kind'], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 5000);
  }, []);

  const openLibraryFile = useCallback(
    async (path: string, announce = true): Promise<boolean> => {
      try {
        const text = await tauriFs.readTextFile(path);
        const doc = parseLbr(text);
        setLibrary({ path, text, devicesets: summariseDevicesets(doc) });
        await saveSettings({ lbrPath: path });
        if (announce) toast('success', `Opened ${path}`);
        return true;
      } catch (e) {
        toast('error', `Could not open ${path}: ${describeError(e)}`);
        return false;
      }
    },
    [toast],
  );

  // Startup: settings + last library
  useEffect(() => {
    void (async () => {
      const s = await loadSettings();
      setCategories(s.categories);
      if (s.lbrPath) await openLibraryFile(s.lbrPath, false);
    })();
  }, [openLibraryFile]);

  const category = useMemo(() => categories.find((c) => c.id === categoryId) ?? categories[0], [categories, categoryId]);

  // Dry run: conversion + merge plan, recomputed when the part, category or library changes
  const converted: ConvertedPart | null = useMemo(() => (model && category ? convertPart(model, category) : null), [model, category]);
  const plan: MergePlan | null = useMemo(() => {
    if (!converted || !library) return null;
    try {
      return planMerge(parseLbr(library.text), converted);
    } catch {
      return null;
    }
  }, [converted, library]);

  async function onOpen() {
    const path = await pickLibraryToOpen(library?.path);
    if (path) await openLibraryFile(path);
  }

  async function onNew() {
    const path = await pickLibraryToCreate();
    if (!path) return;
    try {
      const text = serializeLbr(createEmptyLibrary(referenceLbr));
      await saveLbrSafely(tauriFs, path, text);
      await openLibraryFile(path, false);
      toast('success', `Created ${path}`);
    } catch (e) {
      toast('error', `Could not create library: ${describeError(e)}`);
    }
  }

  async function onFetch() {
    const id = partInput.trim();
    if (!id) return;
    setFetching(true);
    setModel(null);
    setSvgs(null);
    try {
      const m = await easyEda.fetchPart(id);
      setModel(m);
      setCategoryId(suggestCategory(m.info, categories).id);
      easyEda
        .fetchSvgs(id)
        .then(setSvgs)
        .catch(() => setSvgs({}));
    } catch (e) {
      toast('error', describeError(e));
    } finally {
      setFetching(false);
    }
  }

  async function merge(resolutions: Record<string, Resolution>) {
    if (!library || !converted) return;
    setAdding(true);
    try {
      const doc = parseLbr(library.text);
      const result = applyMerge(doc, converted, { resolutions });
      if (result.skipped) {
        toast('info', `${converted.lcsc} is already in the library as ${result.alreadyPresentAs}.`);
        return;
      }
      const text = serializeLbr(doc);
      const saved = await saveLbrSafely(tauriFs, library.path, text);
      setLibrary({ path: library.path, text, devicesets: summariseDevicesets(doc) });
      const extras = [
        result.addedPackages.length ? `package ${result.addedPackages.join(', ')}` : null,
        result.reused.length ? `reused ${result.reused.join(', ')}` : null,
        Object.keys(result.renamed).length ? `renamed ${Object.entries(result.renamed).map(([a, b]) => `${a}→${b}`).join(', ')}` : null,
        saved.backup ? 'backup kept' : null,
      ].filter(Boolean);
      toast('success', `Added ${result.devicesetName}${extras.length ? ` (${extras.join('; ')})` : ''}`);
    } catch (e) {
      toast('error', `Add failed, library unchanged: ${describeError(e)}`);
    } finally {
      setAdding(false);
      setConflictPlan(null);
    }
  }

  function onAdd() {
    if (!plan || !converted) return;
    if (plan.conflicts.length > 0) setConflictPlan(plan);
    else void merge({});
  }

  function onRemoveRequest(name: string) {
    if (!library) return;
    try {
      setRemoval(planRemoval(parseLbr(library.text), name));
    } catch (e) {
      toast('error', describeError(e));
    }
  }

  async function removeDeviceset(removeOrphans: boolean) {
    if (!library || !removal) return;
    setRemoving(true);
    try {
      const doc = parseLbr(library.text);
      const r = applyRemoval(doc, removal.devicesetName, { removeOrphans });
      const text = serializeLbr(doc);
      const saved = await saveLbrSafely(tauriFs, library.path, text);
      setLibrary({ path: library.path, text, devicesets: summariseDevicesets(doc) });
      const extras = [...r.removedPackages.map((p) => `package ${p}`), ...r.removedSymbols.map((s) => `symbol ${s}`)];
      toast('success', `Removed ${r.removedDeviceset}${extras.length ? ` and ${extras.join(', ')}` : ''}${saved.backup ? ' (backup kept)' : ''}`);
    } catch (e) {
      toast('error', `Remove failed, library unchanged: ${describeError(e)}`);
    } finally {
      setRemoving(false);
      setRemoval(null);
    }
  }

  async function onSaveCategories(next: Category[]) {
    setCategories(next);
    setSettingsOpen(false);
    try {
      await saveSettings({ categories: next });
      toast('success', 'Categories saved');
    } catch (e) {
      toast('error', `Could not save settings: ${describeError(e)}`);
    }
  }

  const canAdd = !!library && !!converted && !!plan && !converted.hasErrors && !plan.alreadyPresentAs;

  return (
    <main>
      <header className="topbar">
        <div className="lbr-path" title={library?.path ?? ''}>
          {library ? (
            <>
              <strong>Library:</strong> {library.path}
            </>
          ) : (
            <span className="muted">No library open — open an existing .lbr or create a new one.</span>
          )}
        </div>
        <div className="row">
          <button onClick={onOpen}>Open…</button>
          <button onClick={onNew}>New…</button>
          <button onClick={() => setSettingsOpen(true)} title="Categories">
            Settings
          </button>
        </div>
      </header>

      <section className="card">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void onFetch();
          }}
        >
          <label htmlFor="part">LCSC / JLCPCB part number</label>
          <input id="part" placeholder="C3131" value={partInput} onChange={(e) => setPartInput(e.target.value)} autoFocus spellCheck={false} />
          <button className="primary" type="submit" disabled={fetching || !partInput.trim()}>
            {fetching ? 'Fetching…' : 'Fetch'}
          </button>
        </form>
      </section>

      {model && converted && (
        <PartCard
          model={model}
          svgs={svgs}
          categories={categories}
          categoryId={category.id}
          onCategoryChange={setCategoryId}
          converted={converted}
          plan={plan}
          canAdd={canAdd}
          busy={adding}
          onAdd={onAdd}
        />
      )}

      {library && <LibraryTable items={library.devicesets} onRemove={onRemoveRequest} />}

      {conflictPlan && <ConflictDialog conflicts={conflictPlan.conflicts} onCancel={() => setConflictPlan(null)} onConfirm={(r) => void merge(r)} />}
      {removal && <RemoveDialog plan={removal} busy={removing} onCancel={() => setRemoval(null)} onConfirm={(o) => void removeDeviceset(o)} />}
      {settingsOpen && <SettingsPanel categories={categories} onSave={(c) => void onSaveCategories(c)} onClose={() => setSettingsOpen(false)} />}
      <Toasts items={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </main>
  );
}
