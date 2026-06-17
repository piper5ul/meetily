import { invoke } from '@tauri-apps/api/core';

export interface MeetingTag {
  id: string;
  name: string;
  meetingCount: number;
}

export class TagService {
  async listTags(): Promise<MeetingTag[]> {
    return invoke<MeetingTag[]>('api_list_tags');
  }

  async createTag(name: string): Promise<MeetingTag> {
    return invoke<MeetingTag>('api_create_tag', { name });
  }

  async getMeetingTags(meetingId: string): Promise<MeetingTag[]> {
    return invoke<MeetingTag[]>('api_get_meeting_tags', { meetingId });
  }

  async setMeetingTags(meetingId: string, tagIds: string[]): Promise<MeetingTag[]> {
    return invoke<MeetingTag[]>('api_set_meeting_tags', { meetingId, tagIds });
  }

  async getMeetingsForTag(tagId: string): Promise<Array<{ id: string; title: string }>> {
    return invoke<Array<{ id: string; title: string }>>('api_get_meetings_for_tag', { tagId });
  }
}

export const tagService = new TagService();
