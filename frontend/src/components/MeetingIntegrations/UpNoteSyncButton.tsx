"use client";

import { useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, Send, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { integrationService, UpNoteSyncItem } from '@/services/integrationService';
import Analytics from '@/lib/analytics';

interface UpNoteSyncButtonProps {
  meetingId: string;
  hasSummary: boolean;
}

function syncMessage(item: UpNoteSyncItem): { title: string; description: string } {
  if (item.action === 'imported') {
    return {
      title: 'Synced to UpNote',
      description: `${item.target_notebook} (${item.matched_by})`,
    };
  }
  if (item.action === 'skipped_already_imported') {
    return {
      title: 'Already synced to UpNote',
      description: item.reason || item.target_notebook,
    };
  }
  if (item.action === 'blocked_missing_notebook') {
    return {
      title: 'UpNote notebook missing',
      description: item.reason,
    };
  }
  return {
    title: 'UpNote sync finished',
    description: `${item.action}: ${item.target_notebook}`,
  };
}

export function UpNoteSyncButton({ meetingId, hasSummary }: UpNoteSyncButtonProps) {
  const [open, setOpen] = useState(false);
  const [notebooks, setNotebooks] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!open || notebooks.length > 0 || isLoading) return;

    const loadNotebooks = async () => {
      setIsLoading(true);
      try {
        setNotebooks(await integrationService.listUpNoteNotebooks());
      } catch (error) {
        console.error('Failed to load UpNote notebooks:', error);
        toast.error('Could not load UpNote notebooks');
      } finally {
        setIsLoading(false);
      }
    };

    void loadNotebooks();
  }, [open, notebooks.length, isLoading]);

  const sync = async (notebook?: string) => {
    setIsSyncing(true);
    try {
      const result = await integrationService.syncMeetingToUpNote(meetingId, notebook);
      const item = result.items[0];
      if (!item) {
        toast.error('UpNote sync returned no result');
        return;
      }

      const message = syncMessage(item);
      if (item.action === 'blocked_missing_notebook') {
        toast.error(message.title, { description: message.description });
      } else {
        toast.success(message.title, { description: message.description });
      }
      await Analytics.trackButtonClick('sync_upnote', 'meeting_details');
      setOpen(false);
    } catch (error) {
      console.error('Failed to sync meeting to UpNote:', error);
      toast.error('Failed to sync to UpNote', { description: String(error) });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title="Sync to UpNote"
          disabled={!hasSummary || isSyncing}
          className="cursor-pointer"
        >
          {isSyncing ? <Loader2 className="animate-spin" /> : <Send />}
          <span className="hidden lg:inline">UpNote</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">Sync to UpNote</div>
        <button
          type="button"
          onClick={() => sync()}
          disabled={isSyncing}
          className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4 text-blue-600" />
          <span className="flex-1">Auto route by tag</span>
        </button>
        <div className="my-1 h-px bg-gray-100" />
        {isLoading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading notebooks
          </div>
        ) : notebooks.length > 0 ? (
          <div className="max-h-56 overflow-y-auto">
            {notebooks.map((notebook) => (
              <button
                key={notebook}
                type="button"
                onClick={() => sync(notebook)}
                disabled={isSyncing}
                className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50"
              >
                <Check className="h-4 w-4 text-gray-400" />
                <span className="flex-1 truncate">{notebook}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-start gap-2 px-2 py-3 text-sm text-gray-500">
            <TriangleAlert className="mt-0.5 h-4 w-4" />
            <span>No UpNote notebooks found. Open UpNote backup once, then try again.</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
