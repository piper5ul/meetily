"use client";

import { useState } from 'react';
import { Download, FolderOpen, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Analytics from '@/lib/analytics';
import { MeetingTagsButton } from '@/components/MeetingTags/MeetingTagsButton';
import { UpNoteSyncButton } from '@/components/MeetingIntegrations/UpNoteSyncButton';

interface SummaryMoreActionsProps {
  meetingId: string;
  hasSummary: boolean;
  onExport: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
}

export function SummaryMoreActions({
  meetingId,
  hasSummary,
  onExport,
  onOpenFolder,
}: SummaryMoreActionsProps) {
  const [open, setOpen] = useState(false);

  const runAction = async (name: string, action: () => Promise<void>) => {
    Analytics.trackButtonClick(name, 'meeting_details');
    await action();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title="More actions"
          aria-label="More summary actions"
          className="cursor-pointer"
        >
          <MoreHorizontal />
          <span className="hidden xl:inline">More</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">Actions</div>
        <button
          type="button"
          onClick={() => runAction('export_summary_markdown', onExport)}
          disabled={!hasSummary}
          className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50"
        >
          <Download className="h-4 w-4 text-gray-500" />
          <span className="flex-1">Export Markdown</span>
        </button>
        <button
          type="button"
          onClick={() => runAction('open_meeting_folder', onOpenFolder)}
          className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-gray-100"
        >
          <FolderOpen className="h-4 w-4 text-gray-500" />
          <span className="flex-1">Open Folder</span>
        </button>

        <div className="my-2 h-px bg-gray-100" />
        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">Organize</div>
        <div className="px-1 py-1">
          <MeetingTagsButton meetingId={meetingId} compact />
        </div>

        <div className="my-2 h-px bg-gray-100" />
        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">Integrations</div>
        <div className="px-1 py-1">
          <UpNoteSyncButton meetingId={meetingId} hasSummary={hasSummary} compact />
        </div>
      </PopoverContent>
    </Popover>
  );
}
