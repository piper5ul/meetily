"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Tag as TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MeetingTag, tagService } from "@/services/tagService";
import { TagPickerPopover } from "./TagPickerPopover";

interface MeetingTagsButtonProps {
  meetingId: string;
}

export function MeetingTagsButton({ meetingId }: MeetingTagsButtonProps) {
  const [open, setOpen] = useState(false);
  const [meetingTags, setMeetingTags] = useState<MeetingTag[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const tags = await tagService.getMeetingTags(meetingId);
        if (!cancelled) setMeetingTags(tags);
      } catch (error) {
        console.error("Failed to load meeting tags:", error);
        if (!cancelled) setMeetingTags([]);
      }
    };

    load();

    const onTagsUpdated = () => void load();
    window.addEventListener("meetily-tags-updated", onTagsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("meetily-tags-updated", onTagsUpdated);
    };
  }, [meetingId]);

  const label =
    meetingTags.length === 0
      ? "Tags"
      : meetingTags.length === 1
        ? meetingTags[0].name
        : `${meetingTags[0].name} +${meetingTags.length - 1}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title="Add or remove meeting tags"
          aria-label="Manage meeting tags"
        >
          <TagIcon size={18} />
          <span className="hidden lg:inline max-w-32 truncate">{label}</span>
          <ChevronDown size={14} className="text-gray-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0 border-0 shadow-none bg-transparent">
        <TagPickerPopover meetingId={meetingId} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
