# Meetily Calendar Context Design

## Goal

Meetily should attach calendar-derived context to recordings so meeting titles, participants, attendee emails, organizer details, scheduled times, meeting links, location, and invite notes can be used in the app, summaries, Markdown export, and the existing UpNote sync path.

The first supported source is Apple Calendar on macOS through EventKit. This is the supported local macOS API for reading calendar events with user permission, and it avoids scraping Notion Calendar's Electron cache. Notion Calendar can still benefit indirectly when its meetings are synced into Apple Calendar.

## Non-Goals

- Do not scrape Notion Calendar `IndexedDB`, cookies, or session cache as a core integration.
- Do not add Google or Microsoft OAuth in this slice.
- Do not write or modify calendar events.
- Do not infer participant identity from audio.
- Do not deeply fork Meetily's recording pipeline.

## Architecture

Add a small `calendar` integration boundary next to the existing integrations module:

```text
frontend/src-tauri/src/integrations/
  calendar/
    mod.rs
    models.rs
    eventkit.rs
    repository.rs
    commands.rs
```

The rest of Meetily should consume normalized calendar context and should not call EventKit directly. This keeps the feature rebase-friendly when upstream Meetily changes.

The UI service layer mirrors the existing UpNote service pattern:

```text
frontend/src/services/calendarContextService.ts
frontend/src/components/MeetingIntegrations/CalendarContextButton.tsx
frontend/src/components/MeetingDetails/CalendarContextPanel.tsx
```

Calendar context should be treated as shared meeting metadata, not as a tag and not as UpNote-specific state. UpNote, Markdown export, and summary generation consume it after it is stored.

## Data Model

Add a `meeting_calendar_context` table:

```sql
CREATE TABLE IF NOT EXISTS meeting_calendar_context (
  meeting_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_event_id TEXT,
  calendar_title TEXT,
  organizer_name TEXT,
  organizer_email TEXT,
  starts_at TEXT,
  ends_at TEXT,
  location TEXT,
  meeting_url TEXT,
  notes TEXT,
  attendees_json TEXT NOT NULL,
  raw_event_json TEXT,
  match_status TEXT NOT NULL,
  match_confidence REAL NOT NULL,
  matched_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
```

`attendees_json` stores a normalized array:

```json
[
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "role": "required",
    "status": "accepted"
  }
]
```

Email and response status are optional because EventKit/provider behavior can vary.

## Matching Flow

1. When recording starts, Meetily requests nearby events for the current time window.
2. The matcher scores candidates by time overlap, start-time distance, title similarity, and conferencing URL/location hints.
3. If the best candidate is above the high-confidence threshold, Meetily stores the context and can use the calendar title as the meeting name.
4. If the best candidate is ambiguous, Meetily keeps current recording behavior and surfaces an "Attach calendar event" action in meeting details.
5. Users can manually attach or detach context from meeting details.

Default lookup window:

- Start: 15 minutes before recording start.
- End: 30 minutes after recording start.

Manual attach should show events for the meeting day plus nearby events around the recording time.

## Tauri Commands

Add commands with JSON-friendly payloads:

```text
api_calendar_permission_status
api_calendar_request_access
api_calendar_find_events_for_time
api_calendar_match_event_for_meeting
api_calendar_attach_event_to_meeting
api_calendar_detach_event_from_meeting
api_calendar_get_meeting_context
```

`api_calendar_find_events_for_time` returns normalized events without requiring a meeting row. `api_calendar_match_event_for_meeting` reads meeting metadata and stores the best match only when confidence is sufficient or `force_event_id` is provided.

## UI Behavior

Meeting details should show a compact calendar context panel when context exists:

- Calendar event title.
- Scheduled time.
- Organizer.
- Attendee chips with names and optional emails.
- Location or meeting URL when available.
- A "Change" action for manual override.

When no context exists, the overflow/integrations menu should include "Attach calendar event". If Calendar permission is missing, the action prompts for permission and explains that Meetily reads events locally from Apple Calendar.

The UI should follow the existing quiet utility style used by tags and UpNote. Calendar context is metadata, not a marketing surface.

## Summary Generation

Summary generation should inject a compact, clearly-delimited context block before the transcript:

```text
Calendar context:
Title: ...
Organizer: ...
Participants: ...
Scheduled time: ...
Location or link: ...
Invite notes: ...
```

The prompt should instruct the model to use calendar context for names and roles, but not to invent attendance or decisions that are not in the transcript.

Changing attached calendar context should invalidate the summary cache because the prompt input changed.

## Export And UpNote

Markdown export should include a "Calendar Context" section near the top when present.

UpNote sync should receive the same exported context through the existing Meetily summary/export path or the local bridge payload. The UpNote bridge remains responsible for notebook routing and duplicate protection; calendar context should not become routing configuration.

This keeps the UpNote integration maintainable:

- Calendar integration owns event lookup and normalized context.
- Meeting storage owns persistence.
- Summary/export owns rendering.
- UpNote owns delivery and duplicate handling.

## Privacy And Permissions

Calendar access must be explicit and user-controlled. The app should request read access only. Raw event details are stored locally in the Meetily database and optional meeting folder metadata; no calendar data should be sent to analytics.

Existing analytics sanitization must continue to drop meeting titles, participant names, emails, folder paths, and event notes.

## Error Handling

- Permission denied: show a clear local-calendar permission message and keep current recording behavior.
- No matching event: keep current recording behavior and offer manual attach.
- Ambiguous match: do not auto-attach; show picker.
- EventKit unavailable on non-macOS platforms: commands return unsupported status.
- Missing attendee emails: show names only and avoid treating email as required.

## Testing

Rust:

- Unit-test scoring with exact, nearby, ambiguous, and no-match events.
- Unit-test repository create/update/detach behavior.
- Unit-test summary cache fingerprint changes when calendar context changes.
- Unit-test analytics sanitization still removes calendar-sensitive keys.

Frontend:

- Test service serialization.
- Test calendar context panel states: attached, missing permission, no match, ambiguous match.
- Test manual attach flow uses the selected event.

Manual QA:

- Grant Apple Calendar access.
- Start recording during a real calendar event and verify title/participants are attached.
- Start recording outside an event and verify no false attachment.
- Attach a different event manually.
- Generate summary and confirm participant names are available.
- Export Markdown and sync to UpNote, confirming calendar context appears and duplicate protection still works.

## Implementation Order

1. Add normalized calendar context models, repository, and matcher tests.
2. Add macOS EventKit adapter behind the integration boundary.
3. Register Tauri commands and TypeScript service.
4. Add meeting details panel and attach/change UI.
5. Inject context into summary generation and cache fingerprinting.
6. Include context in Markdown export and UpNote sync payload.
7. Run Rust, TypeScript, and manual macOS Calendar QA.
