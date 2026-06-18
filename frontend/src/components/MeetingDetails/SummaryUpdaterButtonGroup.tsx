"use client";

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, Save, Loader2, Search } from 'lucide-react';
import { ActionTooltip } from '@/components/ui/action-tooltip';
import Analytics from '@/lib/analytics';
import { SummaryMoreActions } from './SummaryMoreActions';

interface SummaryUpdaterButtonGroupProps {
  meetingId: string;
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  onExport: () => Promise<void>;
  onFind?: () => void;
  onOpenFolder: () => Promise<void>;
  hasSummary: boolean;
}

export function SummaryUpdaterButtonGroup({
  meetingId,
  isSaving,
  isDirty,
  onSave,
  onCopy,
  onExport,
  onFind,
  onOpenFolder,
  hasSummary
}: SummaryUpdaterButtonGroupProps) {
  return (
    <ButtonGroup>
      {/* Save button */}
      <ActionTooltip label={isSaving ? "Saving changes" : "Save title and summary changes"}>
        <Button
          variant="outline"
          size="sm"
          className={`${isDirty ? 'bg-green-200' : ""}`}
          onClick={() => {
            Analytics.trackButtonClick('save_changes', 'meeting_details');
            onSave();
          }}
          disabled={isSaving}
        >
          {isSaving ? (
            <>
              <Loader2 className="animate-spin" />
              <span className="hidden lg:inline">Saving...</span>
            </>
          ) : (
            <>
              <Save />
              <span className="hidden lg:inline">Save</span>
            </>
          )}
        </Button>
      </ActionTooltip>

      {/* Copy button */}
      <ActionTooltip label="Copy summary as Markdown">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            Analytics.trackButtonClick('copy_summary', 'meeting_details');
            onCopy();
          }}
          disabled={!hasSummary}
          className="cursor-pointer"
        >
          <Copy />
          <span className="hidden lg:inline">Copy</span>
        </Button>
      </ActionTooltip>

      <SummaryMoreActions
        meetingId={meetingId}
        hasSummary={hasSummary}
        onExport={onExport}
        onOpenFolder={onOpenFolder}
      />

      {/* Find button */}
      {/* {onFind && (
        <Button
          variant="outline"
          size="sm"
          title="Find in Summary"
          onClick={() => {
            Analytics.trackButtonClick('find_in_summary', 'meeting_details');
            onFind();
          }}
          disabled={!hasSummary}
          className="cursor-pointer"
        >
          <Search />
          <span className="hidden lg:inline">Find</span>
        </Button>
      )} */}
    </ButtonGroup>
  );
}
