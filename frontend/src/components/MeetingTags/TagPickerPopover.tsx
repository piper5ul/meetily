"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus, Search, Tag as TagIcon } from "lucide-react";
import { toast } from "sonner";
import { MeetingTag, tagService } from "@/services/tagService";

interface TagPickerPopoverProps {
  meetingId: string;
  onClose: () => void;
}

export function TagPickerPopover({ meetingId, onClose }: TagPickerPopoverProps) {
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<MeetingTag[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const [allTags, meetingTags] = await Promise.all([
          tagService.listTags(),
          tagService.getMeetingTags(meetingId),
        ]);

        if (cancelled) return;
        setTags(allTags);
        setSelectedIds(new Set(meetingTags.map((tag) => tag.id)));
      } catch (error) {
        console.error("Failed to load tags:", error);
        toast.error("Failed to load tags");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredTags = useMemo(() => {
    if (!normalizedQuery) return tags;
    return tags.filter((tag) => tag.name.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, tags]);

  const exactMatch = tags.some((tag) => tag.name.toLowerCase() === normalizedQuery);
  const canCreate = normalizedQuery.length > 0 && !exactMatch;

  const persistSelection = async (nextIds: Set<string>) => {
    setIsSaving(true);
    try {
      await tagService.setMeetingTags(meetingId, Array.from(nextIds));
      window.dispatchEvent(new CustomEvent("meetily-tags-updated"));
    } catch (error) {
      console.error("Failed to save meeting tags:", error);
      toast.error("Failed to save tags");
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const toggleTag = async (tagId: string) => {
    const previousIds = new Set(selectedIds);
    const nextIds = new Set(selectedIds);
    if (nextIds.has(tagId)) {
      nextIds.delete(tagId);
    } else {
      nextIds.add(tagId);
    }

    setSelectedIds(nextIds);
    try {
      await persistSelection(nextIds);
    } catch {
      setSelectedIds(previousIds);
    }
  };

  const createAndSelectTag = async () => {
    const name = query.trim();
    if (!name) return;

    setIsSaving(true);
    try {
      const tag = await tagService.createTag(name);
      const nextTags = tags.some((existing) => existing.id === tag.id) ? tags : [...tags, tag];
      const nextIds = new Set(selectedIds);
      nextIds.add(tag.id);
      setTags(nextTags.sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedIds(nextIds);
      setQuery("");
      await tagService.setMeetingTags(meetingId, Array.from(nextIds));
      window.dispatchEvent(new CustomEvent("meetily-tags-updated"));
      toast.success(`Added tag "${tag.name}"`);
    } catch (error) {
      console.error("Failed to create tag:", error);
      toast.error("Failed to create tag");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="w-80 rounded-lg bg-white border border-gray-200 shadow-lg overflow-hidden"
      role="dialog"
      aria-label="Manage meeting tags"
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
        <Search className="w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canCreate) void createAndSelectTag();
          }}
          placeholder="Search or create tag..."
          className="flex-1 text-sm text-gray-900 bg-transparent border-none outline-none placeholder-gray-400"
        />
        {(isLoading || isSaving) && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
      </div>

      <div className="max-h-80 overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-3 py-3 text-sm text-gray-400">Loading tags...</div>
        ) : (
          <>
            {filteredTags.length > 0 && (
              <div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Tags
              </div>
            )}

            {filteredTags.map((tag) => {
              const selected = selectedIds.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => void toggleTag(tag.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 text-left ${
                    selected ? "text-blue-600 font-medium" : "text-gray-800"
                  }`}
                >
                  <TagIcon className="w-4 h-4 text-gray-400" />
                  <span className="flex-1 truncate">{tag.name}</span>
                  <span className="text-xs text-gray-400">{tag.meetingCount}</span>
                  {selected && <Check className="w-4 h-4 text-blue-600" aria-hidden="true" />}
                </button>
              );
            })}

            {canCreate && (
              <button
                type="button"
                onClick={() => void createAndSelectTag()}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 text-left border-t border-gray-100"
              >
                <Plus className="w-4 h-4" />
                <span>Create "{query.trim()}"</span>
              </button>
            )}

            {!canCreate && filteredTags.length === 0 && (
              <div className="px-3 py-3 text-sm text-gray-400">No tags found</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
