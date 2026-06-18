import { invoke } from '@tauri-apps/api/core';

export interface UpNoteSyncItem {
  meeting_id: string;
  title: string;
  target_notebook: string;
  matched_by: string;
  action: 'imported' | 'skipped_already_imported' | 'blocked_missing_notebook' | 'would_import' | string;
  reason: string;
}

export interface UpNoteSyncResponse {
  items: UpNoteSyncItem[];
  sync_log_created: boolean;
}

export class IntegrationService {
  async listUpNoteNotebooks(): Promise<string[]> {
    return invoke<string[]>('api_list_upnote_notebooks');
  }

  async syncMeetingToUpNote(meetingId: string, notebook?: string, force = false): Promise<UpNoteSyncResponse> {
    return invoke<UpNoteSyncResponse>('api_sync_meeting_to_upnote', {
      meetingId,
      notebook: notebook || null,
      force,
    });
  }
}

export const integrationService = new IntegrationService();
