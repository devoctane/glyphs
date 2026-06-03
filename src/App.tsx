import { useEffect, useMemo, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  type ClipboardItem,
  type Group,
  subscribeToBackend,
  useClipboardStore,
} from "./store/use-clipboard-store";
import { SearchBar } from "./features/clipboard/components/search-bar";
import { ClipboardList } from "./features/clipboard/components/clipboard-list";
import { GroupChips } from "./features/clipboard/components/group-chips";
import { GroupModal } from "./features/clipboard/components/group-modal";
import { MoveCategoryModal } from "./features/clipboard/components/move-category-modal";

import { Footer } from "./features/clipboard/components/footer";
import { useShortcuts } from "./features/clipboard/shortcuts/use-shortcuts";
import { QrModal } from "./features/clipboard/components/qr-modal";
import { ShortcutsModal } from "./features/clipboard/components/shortcuts-modal";
import { SettingsPage } from "./features/settings/components/settings-page";
import { ItemPreview } from "./features/clipboard/components/item-preview";

const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export default function App() {
  const {
    items,
    groups,
    activeGroupId,
    setActiveGroupId,
    searchQuery,
    setSearchQuery,
    settings,
    loadHistory,
    loadGroups,
    loadSettings,
    clearHistory,
    pasteItem,
    deleteItem,
    togglePin,
  } = useClipboardStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qrContent, setQrContent] = useState<string | null>(null);
  const [moveModalItem, setMoveModalItem] = useState<ClipboardItem | null>(
    null,
  );
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const [previewState, setPreviewState] = useState<{
    item: ClipboardItem;
    rect: DOMRect;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previewTimerRef = useRef<number | null>(null);

  // Hover-preview dispatcher with a single shared timer. The first show waits
  // a beat so accidental fly-overs don't pop the popover; once it's visible,
  // moving between rows updates instantly (the user is clearly browsing).
  const handlePreview = (item: ClipboardItem | null, rect: DOMRect | null) => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (!item || !rect) {
      setPreviewState(null);
      return;
    }
    if (previewState) {
      setPreviewState({ item, rect });
      return;
    }
    previewTimerRef.current = window.setTimeout(() => {
      setPreviewState({ item, rect });
      previewTimerRef.current = null;
    }, 320);
  };

  // Register backend listeners first, then load initial data — this avoids the
  // startup race where a clipboard event fires before the listener is bound.
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const unsubscribe = await subscribeToBackend();
      if (cancelled) {
        unsubscribe();
        return;
      }
      cleanup = unsubscribe;
      await Promise.all([loadHistory(), loadGroups(), loadSettings()]);
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [loadHistory, loadGroups, loadSettings]);

  // Apply theme to <html>. "system" follows prefers-color-scheme live.
  useEffect(() => {
    const root = document.documentElement;
    const apply = (mode: "light" | "dark") => {
      root.classList.toggle("dark", mode === "dark");
    };
    if (settings.theme === "light" || settings.theme === "dark") {
      apply(settings.theme);
      return;
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    apply(mql.matches ? "dark" : "light");
    const handler = (e: MediaQueryListEvent) =>
      apply(e.matches ? "dark" : "light");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [settings.theme]);

  // Refocus the search input every time the window is shown (the input only
  // autofocuses on initial mount; toggle_window emits window-shown on every
  // open). Also reset the query so each session starts fresh.
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const unlisten = await listen("window-shown", () => {
        setSearchQuery("");
        // Focus on the next tick so the show animation has settled.
        requestAnimationFrame(() => searchRef.current?.focus());
      });
      if (cancelled) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [setSearchQuery]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (activeGroupId !== "all" && item.groupId !== activeGroupId)
          return false;
        if (!searchQuery) return true;
        if (item.type === "image") return false;
        return item.content.toLowerCase().includes(searchQuery.toLowerCase());
      }),
    [items, activeGroupId, searchQuery],
  );

  const pinnedItems = useMemo(
    () => filteredItems.filter((i) => i.isPinned),
    [filteredItems],
  );
  const recentItems = useMemo(
    () => filteredItems.filter((i) => !i.isPinned),
    [filteredItems],
  );
  const displayItems = useMemo(
    () => [...pinnedItems, ...recentItems],
    [pinnedItems, recentItems],
  );

  // If the previously-selected item leaves the visible set (filtered out,
  // deleted, etc.) snap back to the first item.
  useEffect(() => {
    if (displayItems.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !displayItems.some((i) => i.id === selectedId)) {
      setSelectedId(displayItems[0].id);
    }
  }, [displayItems, selectedId]);

  const isAnyModalOpen =
    isGroupModalOpen ||
    isShortcutsModalOpen ||
    qrContent !== null ||
    moveModalItem !== null ||
    isSettingsOpen;

  // Tear down any in-flight or visible preview when a modal opens, settings
  // appears, or the underlying list disappears — otherwise the floating
  // popover hangs around behind a modal or after its anchor scrolls away.
  useEffect(() => {
    if (isAnyModalOpen) {
      if (previewTimerRef.current !== null) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      setPreviewState(null);
    }
  }, [isAnyModalOpen]);

  useShortcuts({
    displayItems,
    selectedId,
    setSelectedId,
    searchQuery,
    setSearchQuery,
    searchRef,
    pasteItem,
    deleteItem,
    togglePin,
    isAnyModalOpen,
    setIsGroupModalOpen,
    groups,
    activeGroupId,
    setActiveGroupId,
    setIsShortcutsModalOpen,
    isSettingsOpen,
    setIsSettingsOpen,
  });

  return (
    <div
      data-tauri-drag-region
      className={`flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-foreground/20 text-foreground dark:border-foreground/10 ${
        isMac ? "bg-white/70 dark:bg-transparent" : "bg-background"
      }`}
    >
      <div className="no-drag flex min-h-0 flex-1 flex-col overflow-hidden border-t border-foreground/20">
        {isSettingsOpen ? (
          <SettingsPage onClose={() => setIsSettingsOpen(false)} />
        ) : (
          <>
            <SearchBar
              ref={searchRef}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              showClearButton={items.length > 0}
              onClearHistory={clearHistory}
            />

            <GroupChips
              onAddGroup={() => {
                setEditGroup(null);
                setIsGroupModalOpen(true);
              }}
              onEditGroup={(group) => {
                setEditGroup(group);
                setIsGroupModalOpen(true);
              }}
            />
            <ClipboardList
              items={displayItems}
              pinnedItems={pinnedItems}
              recentItems={recentItems}
              searchQuery={searchQuery}
              selectedId={selectedId}
              onPasteItem={pasteItem}
              onShowQr={setQrContent}
              onShowMove={setMoveModalItem}
              onPreviewChange={handlePreview}
            />
          </>
        )}
      </div>

      {settings.showFooter && (
        <Footer
          onOpenShortcuts={() => setIsShortcutsModalOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      )}

      {qrContent && (
        <QrModal content={qrContent} onClose={() => setQrContent(null)} />
      )}
      {moveModalItem && (
        <MoveCategoryModal
          item={moveModalItem}
          onClose={() => setMoveModalItem(null)}
        />
      )}
      {isGroupModalOpen && (
        <GroupModal
          editGroup={editGroup}
          onClose={() => {
            setIsGroupModalOpen(false);
            setEditGroup(null);
          }}
        />
      )}
      {isShortcutsModalOpen && (
        <ShortcutsModal onClose={() => setIsShortcutsModalOpen(false)} />
      )}

      {previewState && !isAnyModalOpen && (
        <ItemPreview
          item={previewState.item}
          rect={previewState.rect}
          groups={groups}
        />
      )}
    </div>
  );
}
