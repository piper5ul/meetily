# Calendar Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add maintainable Apple Calendar context capture to Meetily so meetings can use calendar titles, attendees, emails, organizer details, notes, times, and links in summaries, Markdown export, and UpNote sync.

**Architecture:** Calendar access is isolated behind `frontend/src-tauri/src/integrations/calendar/`. The rest of the app consumes normalized `CalendarContext` records from storage, so the existing UpNote integration remains a downstream delivery path rather than owning calendar behavior. EventKit is macOS-only; non-macOS commands return an explicit unsupported status.

**Tech Stack:** Tauri 2, Rust, SQLite through `sqlx`, Swift/EventKit helper binary for macOS calendar reads, Next.js/React/TypeScript, lucide icons, existing `sonner` toasts.

---

## File Structure

- Create: `frontend/src-tauri/src/integrations/calendar/mod.rs`
  - Exposes calendar submodules.
- Create: `frontend/src-tauri/src/integrations/calendar/models.rs`
  - Normalized structs for events, attendees, permission status, context rows, and match decisions.
- Create: `frontend/src-tauri/src/integrations/calendar/matcher.rs`
  - Pure Rust scoring logic with deterministic unit tests.
- Create: `frontend/src-tauri/src/integrations/calendar/repository.rs`
  - SQLite persistence for `meeting_calendar_context`.
- Create: `frontend/src-tauri/src/integrations/calendar/eventkit.rs`
  - Rust adapter that calls the macOS helper and returns normalized events.
- Create: `frontend/src-tauri/src/integrations/calendar/commands.rs`
  - Tauri command functions.
- Create: `frontend/src-tauri/src/integrations/calendar/eventkit_helper.swift`
  - Small EventKit CLI used only on macOS.
- Modify: `frontend/src-tauri/build.rs`
  - Link EventKit and compile the Swift helper to `frontend/src-tauri/binaries/eventkit-helper-<target>`.
- Modify: `frontend/src-tauri/tauri.conf.json`
  - Add the helper to `bundle.externalBin`.
- Modify: `frontend/src-tauri/Info.plist`
  - Add Calendar privacy usage descriptions.
- Modify: `frontend/src-tauri/entitlements.plist`
  - Add Calendar personal-information entitlement for signed macOS builds.
- Modify: `frontend/src-tauri/src/integrations/mod.rs`
  - Add `pub mod calendar;`.
- Modify: `frontend/src-tauri/src/lib.rs`
  - Register new Tauri commands.
- Modify: `frontend/src-tauri/src/database/repositories/meeting.rs`
  - Delete calendar context alongside meeting deletion if foreign keys are not active.
- Modify: `frontend/src-tauri/src/summary/service.rs` and `frontend/src-tauri/src/summary/processor.rs`
  - Inject calendar context into the summary prompt and cache fingerprint.
- Modify: `frontend/src/hooks/meeting-details/useCopyOperations.ts`
  - Add a Calendar Context section to Markdown copy/export.
- Create: `frontend/src/services/calendarContextService.ts`
  - Frontend service wrapper for Tauri commands.
- Create: `frontend/src/components/MeetingDetails/CalendarContextPanel.tsx`
  - Compact display of attached context.
- Create: `frontend/src/components/MeetingIntegrations/CalendarContextButton.tsx`
  - Attach/change calendar event action for meeting details.
- Modify: `frontend/src/app/meeting-details/page-content.tsx`
  - Load context and pass it into summary/export components.
- Modify: `frontend/src/components/MeetingDetails/SummaryPanel.tsx`
  - Render context panel and pass context into the More menu/export.
- Modify: `frontend/src/components/MeetingDetails/SummaryMoreActions.tsx`
  - Add calendar action beside Tags and UpNote.
- Modify: `frontend/src/hooks/useRecordingStart.ts`
  - Best-effort match calendar title before recording starts.

## Verification Commands

Use these commands throughout the tasks:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib integrations::calendar -- --nocapture
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib analytics::analytics::tests::analytics_properties_drop_sensitive_meeting_metadata -- --nocapture
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm run build
```

Manual QA requires macOS Calendar access:

```bash
cd frontend
pnpm run tauri:dev
```

---

### Task 1: Calendar Models And Matcher

**Files:**
- Create: `frontend/src-tauri/src/integrations/calendar/mod.rs`
- Create: `frontend/src-tauri/src/integrations/calendar/models.rs`
- Create: `frontend/src-tauri/src/integrations/calendar/matcher.rs`
- Modify: `frontend/src-tauri/src/integrations/mod.rs`

- [ ] **Step 1: Write the failing matcher tests**

Add `frontend/src-tauri/src/integrations/calendar/matcher.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::calendar::models::{CalendarAttendee, CalendarEvent};
    use chrono::{TimeZone, Utc};

    fn event(id: &str, title: &str, start_minute: i64, end_minute: i64) -> CalendarEvent {
        CalendarEvent {
            source: "apple_calendar".to_string(),
            source_event_id: Some(id.to_string()),
            calendar_title: title.to_string(),
            organizer_name: Some("Organizer".to_string()),
            organizer_email: Some("organizer@example.com".to_string()),
            starts_at: Utc.with_ymd_and_hms(2026, 7, 14, 14, 0, 0).unwrap()
                + chrono::Duration::minutes(start_minute),
            ends_at: Utc.with_ymd_and_hms(2026, 7, 14, 14, 0, 0).unwrap()
                + chrono::Duration::minutes(end_minute),
            location: None,
            meeting_url: None,
            notes: None,
            attendees: vec![CalendarAttendee {
                name: Some("Jane Doe".to_string()),
                email: Some("jane@example.com".to_string()),
                role: Some("required".to_string()),
                status: Some("accepted".to_string()),
            }],
            raw_event_json: None,
        }
    }

    #[test]
    fn exact_time_and_title_match_is_high_confidence() {
        let recording_start = Utc.with_ymd_and_hms(2026, 7, 14, 14, 2, 0).unwrap();
        let candidates = vec![
            event("a", "Client Strategy", 0, 30),
            event("b", "Lunch", 120, 180),
        ];

        let decision = best_calendar_match(
            "Client Strategy",
            recording_start,
            &candidates,
        ).expect("match");

        assert_eq!(decision.event.source_event_id.as_deref(), Some("a"));
        assert!(decision.confidence >= 0.80, "{:?}", decision);
        assert_eq!(decision.status, CalendarMatchStatus::HighConfidence);
    }

    #[test]
    fn ambiguous_nearby_events_do_not_auto_attach() {
        let recording_start = Utc.with_ymd_and_hms(2026, 7, 14, 14, 5, 0).unwrap();
        let candidates = vec![
            event("a", "Project Sync", 0, 30),
            event("b", "Product Sync", 0, 30),
        ];

        let decision = best_calendar_match("Sync", recording_start, &candidates).expect("match");

        assert_eq!(decision.status, CalendarMatchStatus::Ambiguous);
        assert!(decision.confidence < 0.80, "{:?}", decision);
    }

    #[test]
    fn no_overlap_and_unrelated_title_returns_none() {
        let recording_start = Utc.with_ymd_and_hms(2026, 7, 14, 14, 0, 0).unwrap();
        let candidates = vec![event("a", "Dinner", 180, 240)];

        assert!(best_calendar_match("Client Strategy", recording_start, &candidates).is_none());
    }
}
```

- [ ] **Step 2: Run the matcher tests and verify they fail**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib integrations::calendar::matcher -- --nocapture
```

Expected: compile failure because `integrations::calendar`, `CalendarEvent`, and `best_calendar_match` are not defined.

- [ ] **Step 3: Add models and matcher implementation**

Create `frontend/src-tauri/src/integrations/calendar/mod.rs`:

```rust
pub mod matcher;
pub mod models;
```

Modify `frontend/src-tauri/src/integrations/mod.rs`:

```rust
pub mod calendar;
pub mod upnote;
```

Create `frontend/src-tauri/src/integrations/calendar/models.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CalendarAttendee {
    pub name: Option<String>,
    pub email: Option<String>,
    pub role: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub source: String,
    pub source_event_id: Option<String>,
    pub calendar_title: String,
    pub organizer_name: Option<String>,
    pub organizer_email: Option<String>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub location: Option<String>,
    pub meeting_url: Option<String>,
    pub notes: Option<String>,
    pub attendees: Vec<CalendarAttendee>,
    pub raw_event_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalendarMatchStatus {
    HighConfidence,
    Ambiguous,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CalendarMatchDecision {
    pub event: CalendarEvent,
    pub confidence: f64,
    pub status: CalendarMatchStatus,
    pub matched_by: String,
}
```

Implement `frontend/src-tauri/src/integrations/calendar/matcher.rs` with pure scoring functions:

```rust
use chrono::{DateTime, Utc};

use super::models::{CalendarEvent, CalendarMatchDecision, CalendarMatchStatus};

const HIGH_CONFIDENCE: f64 = 0.80;
const MIN_CONFIDENCE: f64 = 0.35;
const AMBIGUITY_GAP: f64 = 0.12;

pub fn best_calendar_match(
    meeting_title: &str,
    recording_start: DateTime<Utc>,
    candidates: &[CalendarEvent],
) -> Option<CalendarMatchDecision> {
    let mut scored = candidates
        .iter()
        .cloned()
        .map(|event| {
            let confidence = score_event(meeting_title, recording_start, &event);
            (event, confidence)
        })
        .filter(|(_, confidence)| *confidence >= MIN_CONFIDENCE)
        .collect::<Vec<_>>();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let (event, confidence) = scored.first()?.clone();
    let next_confidence = scored.get(1).map(|(_, score)| *score).unwrap_or(0.0);
    let status = if confidence >= HIGH_CONFIDENCE && confidence - next_confidence >= AMBIGUITY_GAP {
        CalendarMatchStatus::HighConfidence
    } else {
        CalendarMatchStatus::Ambiguous
    };

    Some(CalendarMatchDecision {
        event,
        confidence,
        status,
        matched_by: "time_title_overlap".to_string(),
    })
}

fn score_event(meeting_title: &str, recording_start: DateTime<Utc>, event: &CalendarEvent) -> f64 {
    let title_score = title_similarity(meeting_title, &event.calendar_title);
    let time_score = time_score(recording_start, event);
    (title_score * 0.45) + (time_score * 0.55)
}

fn time_score(recording_start: DateTime<Utc>, event: &CalendarEvent) -> f64 {
    if recording_start >= event.starts_at && recording_start <= event.ends_at {
        return 1.0;
    }

    let distance = if recording_start < event.starts_at {
        event.starts_at - recording_start
    } else {
        recording_start - event.ends_at
    };
    let minutes = distance.num_minutes().abs() as f64;
    (1.0 - (minutes / 30.0)).clamp(0.0, 1.0)
}

fn title_similarity(a: &str, b: &str) -> f64 {
    let a_tokens = tokens(a);
    let b_tokens = tokens(b);
    if a_tokens.is_empty() || b_tokens.is_empty() {
        return 0.0;
    }
    let overlap = a_tokens.intersection(&b_tokens).count() as f64;
    let union = a_tokens.union(&b_tokens).count() as f64;
    overlap / union
}

fn tokens(value: &str) -> std::collections::BTreeSet<String> {
    value
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter_map(|part| {
            let trimmed = part.trim().to_ascii_lowercase();
            if trimmed.len() < 2 { None } else { Some(trimmed) }
        })
        .collect()
}
```

- [ ] **Step 4: Run matcher tests and commit**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib integrations::calendar::matcher -- --nocapture
```

Expected: all matcher tests pass.

Commit:

```bash
git add frontend/src-tauri/src/integrations/mod.rs frontend/src-tauri/src/integrations/calendar
git commit -m "feat(calendar): add event matching model"
```

---

### Task 2: Calendar Context Persistence

**Files:**
- Create: `frontend/src-tauri/src/integrations/calendar/repository.rs`
- Modify: `frontend/src-tauri/src/integrations/calendar/mod.rs`
- Modify: `frontend/src-tauri/src/database/repositories/meeting.rs`

- [ ] **Step 1: Write repository tests**

Create `frontend/src-tauri/src/integrations/calendar/repository.rs` with tests that create an in-memory SQLite database, insert a meeting, save context, load context, and detach context.

The first test should assert:

```rust
assert_eq!(loaded.calendar_title.as_deref(), Some("Client Strategy"));
assert_eq!(loaded.attendees.len(), 1);
assert_eq!(loaded.attendees[0].email.as_deref(), Some("jane@example.com"));
```

The detach test should assert:

```rust
CalendarContextRepository::detach(&pool, "meeting-a").await.unwrap();
assert!(CalendarContextRepository::get(&pool, "meeting-a").await.unwrap().is_none());
```

- [ ] **Step 2: Run repository tests and verify they fail**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib integrations::calendar::repository -- --nocapture
```

Expected: compile failure because repository types and table creation are not implemented.

- [ ] **Step 3: Implement repository**

Add `pub mod repository;` to `frontend/src-tauri/src/integrations/calendar/mod.rs`.

Define `CalendarContext` in `models.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CalendarContext {
    pub meeting_id: String,
    pub source: String,
    pub source_event_id: Option<String>,
    pub calendar_title: Option<String>,
    pub organizer_name: Option<String>,
    pub organizer_email: Option<String>,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub location: Option<String>,
    pub meeting_url: Option<String>,
    pub notes: Option<String>,
    pub attendees: Vec<CalendarAttendee>,
    pub raw_event_json: Option<serde_json::Value>,
    pub match_status: String,
    pub match_confidence: f64,
    pub matched_by: String,
}
```

Implement `CalendarContextRepository` with:

```rust
pub struct CalendarContextRepository;

impl CalendarContextRepository {
    pub async fn ensure_table(pool: &sqlx::SqlitePool) -> Result<(), sqlx::Error> { /* create table */ }
    pub async fn save(pool: &sqlx::SqlitePool, context: &CalendarContext) -> Result<(), sqlx::Error> { /* insert or update */ }
    pub async fn get(pool: &sqlx::SqlitePool, meeting_id: &str) -> Result<Option<CalendarContext>, sqlx::Error> { /* select */ }
    pub async fn detach(pool: &sqlx::SqlitePool, meeting_id: &str) -> Result<(), sqlx::Error> { /* delete */ }
}
```

Use `serde_json::to_string(&context.attendees)` and `serde_json::from_str` for `attendees_json`. Store timestamps as RFC3339 strings.

- [ ] **Step 4: Call table setup from command/repository entry points**

Call `CalendarContextRepository::ensure_table(pool).await` inside every repository method before reading or writing. This avoids needing a global migration system in this slice and keeps existing first-launch behavior intact.

- [ ] **Step 5: Run repository tests and commit**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib integrations::calendar::repository -- --nocapture
```

Expected: repository tests pass.

Commit:

```bash
git add frontend/src-tauri/src/integrations/calendar frontend/src-tauri/src/database/repositories/meeting.rs
git commit -m "feat(calendar): persist meeting calendar context"
```

---

### Task 3: macOS EventKit Adapter

**Files:**
- Create: `frontend/src-tauri/src/integrations/calendar/eventkit.rs`
- Create: `frontend/src-tauri/src/integrations/calendar/eventkit_helper.swift`
- Modify: `frontend/src-tauri/src/integrations/calendar/mod.rs`
- Modify: `frontend/src-tauri/build.rs`
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/Info.plist`
- Modify: `frontend/src-tauri/entitlements.plist`

- [ ] **Step 1: Add failing adapter tests for JSON parsing**

Add Rust tests in `eventkit.rs` for parsing helper JSON:

```rust
#[test]
fn parses_eventkit_helper_events() {
    let raw = r#"{"events":[{"source":"apple_calendar","source_event_id":"abc","calendar_title":"Client Strategy","starts_at":"2026-07-14T18:00:00Z","ends_at":"2026-07-14T18:30:00Z","attendees":[{"name":"Jane Doe","email":"jane@example.com","role":"required","status":"accepted"}]}]}"#;
    let events = parse_events_json(raw).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].calendar_title, "Client Strategy");
    assert_eq!(events[0].attendees[0].email.as_deref(), Some("jane@example.com"));
}
```

- [ ] **Step 2: Run adapter test and verify it fails**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib integrations::calendar::eventkit -- --nocapture
```

Expected: compile failure because `eventkit.rs` and `parse_events_json` are not implemented.

- [ ] **Step 3: Implement Swift helper**

Create `eventkit_helper.swift` with commands:

```text
eventkit-helper status
eventkit-helper request-access
eventkit-helper events --start 2026-07-14T18:00:00Z --end 2026-07-14T19:00:00Z
```

The helper prints one JSON object to stdout and diagnostic errors to stderr. It never writes calendar data.

JSON shapes:

```json
{"status":"authorized"}
{"granted":true,"status":"authorized"}
{"events":[{"source":"apple_calendar","source_event_id":"event-123","calendar_title":"Client Strategy","starts_at":"2026-07-14T18:00:00Z","ends_at":"2026-07-14T18:30:00Z","attendees":[]}]}
```

Use `EKEventStore`, `authorizationStatus(for: .event)`, `requestFullAccessToEvents` on macOS 14+, and `requestAccess(to: .event)` on older macOS.

- [ ] **Step 4: Compile helper from build.rs**

Modify `frontend/src-tauri/build.rs`:

```rust
#[cfg(target_os = "macos")]
fn build_eventkit_helper() {
    use std::path::PathBuf;
    let target = std::env::var("TARGET").expect("TARGET is set by cargo");
    let source = PathBuf::from("src/integrations/calendar/eventkit_helper.swift");
    let out = PathBuf::from("binaries").join(format!("eventkit-helper-{}", target));
    std::fs::create_dir_all("binaries").expect("create binaries dir");
    let status = std::process::Command::new("swiftc")
        .arg("-O")
        .arg("-framework")
        .arg("EventKit")
        .arg(&source)
        .arg("-o")
        .arg(&out)
        .status()
        .expect("swiftc must be available on macOS");
    assert!(status.success(), "failed to compile EventKit helper");
    println!("cargo:rerun-if-changed={}", source.display());
}
```

Call it inside the existing macOS block and add:

```rust
println!("cargo:rustc-link-lib=framework=EventKit");
```

- [ ] **Step 5: Add packaging and permissions**

Add `"binaries/eventkit-helper"` to `bundle.externalBin` in `frontend/src-tauri/tauri.conf.json`.

Add to `Info.plist`:

```xml
<key>NSCalendarsFullAccessUsageDescription</key>
<string>Meetily reads your calendar events locally to attach meeting titles, participants, and invite context to recordings.</string>
<key>NSCalendarsUsageDescription</key>
<string>Meetily reads your calendar events locally to attach meeting titles, participants, and invite context to recordings.</string>
```

Add to `entitlements.plist`:

```xml
<key>com.apple.security.personal-information.calendars</key>
<true/>
```

- [ ] **Step 6: Implement Rust adapter**

`eventkit.rs` should expose:

```rust
pub async fn permission_status() -> Result<CalendarPermissionStatus, String>;
pub async fn request_access() -> Result<CalendarAccessResponse, String>;
pub async fn events_between(start: DateTime<Utc>, end: DateTime<Utc>) -> Result<Vec<CalendarEvent>, String>;
```

Resolve helper path by checking:

1. `MEETILY_EVENTKIT_HELPER`.
2. `frontend/src-tauri/binaries/eventkit-helper-<target>` in development.
3. Current executable/resource sibling paths in packaged builds.

On non-macOS, return `Err("Apple Calendar integration is only supported on macOS".to_string())`.

- [ ] **Step 7: Run adapter tests and build check**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib integrations::calendar::eventkit -- --nocapture
cargo build --manifest-path frontend/src-tauri/Cargo.toml --no-default-features
```

Expected: tests pass and helper binary exists in `frontend/src-tauri/binaries/`.

Commit:

```bash
git add frontend/src-tauri/src/integrations/calendar frontend/src-tauri/build.rs frontend/src-tauri/tauri.conf.json frontend/src-tauri/Info.plist frontend/src-tauri/entitlements.plist frontend/src-tauri/binaries/eventkit-helper-*
git commit -m "feat(calendar): add macOS EventKit adapter"
```

---

### Task 4: Tauri Commands And Frontend Service

**Files:**
- Create: `frontend/src-tauri/src/integrations/calendar/commands.rs`
- Modify: `frontend/src-tauri/src/integrations/calendar/mod.rs`
- Modify: `frontend/src-tauri/src/lib.rs`
- Create: `frontend/src/services/calendarContextService.ts`

- [ ] **Step 1: Add command mapping tests**

Add a unit test in `commands.rs` for the pure helper that converts a selected `CalendarEvent` into a stored `CalendarContext`. The test should assert that manual attaches set `match_status` to `"manual"`, `matched_by` to `"manual"`, and preserve attendee emails:

```rust
#[test]
fn selected_event_becomes_manual_context() {
    let event = CalendarEvent {
        source: "apple_calendar".to_string(),
        source_event_id: Some("event-123".to_string()),
        calendar_title: "Client Strategy".to_string(),
        organizer_name: Some("Organizer".to_string()),
        organizer_email: Some("organizer@example.com".to_string()),
        starts_at: chrono::Utc::now(),
        ends_at: chrono::Utc::now(),
        location: None,
        meeting_url: Some("https://meet.example.com".to_string()),
        notes: Some("Discuss launch plan".to_string()),
        attendees: vec![CalendarAttendee {
            name: Some("Jane Doe".to_string()),
            email: Some("jane@example.com".to_string()),
            role: Some("required".to_string()),
            status: Some("accepted".to_string()),
        }],
        raw_event_json: None,
    };

    let context = context_from_event("meeting-a", event, 1.0, "manual");

    assert_eq!(context.meeting_id, "meeting-a");
    assert_eq!(context.match_status, "manual");
    assert_eq!(context.matched_by, "manual");
    assert_eq!(context.attendees[0].email.as_deref(), Some("jane@example.com"));
}
```

- [ ] **Step 2: Implement commands**

Add `pub mod commands;` to the calendar module.

Implement commands:

```rust
use chrono::{DateTime, Utc};
use tauri::{AppHandle, Manager, Runtime};

use crate::integrations::calendar::{
    eventkit,
    models::{CalendarAccessResponse, CalendarContext, CalendarEvent, CalendarPermissionStatus},
    repository::CalendarContextRepository,
};
use crate::state::AppState;

#[tauri::command]
pub async fn api_calendar_permission_status() -> Result<CalendarPermissionStatus, String> {
    eventkit::permission_status().await
}

#[tauri::command]
pub async fn api_calendar_request_access() -> Result<CalendarAccessResponse, String> {
    eventkit::request_access().await
}

#[tauri::command]
pub async fn api_calendar_find_events_for_time(start: String, end: String) -> Result<Vec<CalendarEvent>, String> {
    let start = DateTime::parse_from_rfc3339(&start)
        .map_err(|e| format!("Invalid start time: {}", e))?
        .with_timezone(&Utc);
    let end = DateTime::parse_from_rfc3339(&end)
        .map_err(|e| format!("Invalid end time: {}", e))?
        .with_timezone(&Utc);
    eventkit::events_between(start, end).await
}

#[tauri::command]
pub async fn api_calendar_get_meeting_context<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
) -> Result<Option<CalendarContext>, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.get_pool();
    CalendarContextRepository::get(pool, &meeting_id)
        .await
        .map_err(|e| format!("Failed to load calendar context: {}", e))
}

#[tauri::command]
pub async fn api_calendar_attach_event_to_meeting<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    event: CalendarEvent,
    confidence: Option<f64>,
    matched_by: Option<String>,
) -> Result<CalendarContext, String> {
    let context = context_from_event(
        &meeting_id,
        event,
        confidence.unwrap_or(1.0),
        matched_by.as_deref().unwrap_or("manual"),
    );
    let state = app.state::<AppState>();
    let pool = state.db_manager.get_pool();
    CalendarContextRepository::save(pool, &context)
        .await
        .map_err(|e| format!("Failed to save calendar context: {}", e))?;
    Ok(context)
}

#[tauri::command]
pub async fn api_calendar_detach_event_from_meeting<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.get_pool();
    CalendarContextRepository::detach(pool, &meeting_id)
        .await
        .map_err(|e| format!("Failed to detach calendar context: {}", e))
}
```

Use `AppState` to get the database pool, following existing API command patterns.

- [ ] **Step 3: Register Tauri commands**

Modify `frontend/src-tauri/src/lib.rs` inside `tauri::generate_handler!`:

```rust
integrations::calendar::commands::api_calendar_permission_status,
integrations::calendar::commands::api_calendar_request_access,
integrations::calendar::commands::api_calendar_find_events_for_time,
integrations::calendar::commands::api_calendar_get_meeting_context,
integrations::calendar::commands::api_calendar_attach_event_to_meeting,
integrations::calendar::commands::api_calendar_detach_event_from_meeting,
```

- [ ] **Step 4: Add TypeScript service**

Create `frontend/src/services/calendarContextService.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

export interface CalendarAttendee {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  status?: string | null;
}

export interface CalendarEvent {
  source: string;
  source_event_id?: string | null;
  calendar_title: string;
  organizer_name?: string | null;
  organizer_email?: string | null;
  starts_at: string;
  ends_at: string;
  location?: string | null;
  meeting_url?: string | null;
  notes?: string | null;
  attendees: CalendarAttendee[];
}

export interface CalendarContext extends CalendarEvent {
  meeting_id: string;
  calendar_title?: string | null;
  match_status: string;
  match_confidence: number;
  matched_by: string;
}

export const calendarContextService = {
  permissionStatus: () => invoke<{ status: string }>('api_calendar_permission_status'),
  requestAccess: () => invoke<{ granted: boolean; status: string }>('api_calendar_request_access'),
  findEvents: (start: string, end: string) =>
    invoke<CalendarEvent[]>('api_calendar_find_events_for_time', { start, end }),
  getMeetingContext: (meetingId: string) =>
    invoke<CalendarContext | null>('api_calendar_get_meeting_context', { meetingId }),
  attachEvent: (meetingId: string, event: CalendarEvent, confidence = 1, matchedBy = 'manual') =>
    invoke<CalendarContext>('api_calendar_attach_event_to_meeting', {
      meetingId,
      event,
      confidence,
      matchedBy,
    }),
  detachEvent: (meetingId: string) =>
    invoke<void>('api_calendar_detach_event_from_meeting', { meetingId }),
};
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib integrations::calendar -- --nocapture
cd frontend && pnpm exec tsc --noEmit
```

Commit:

```bash
git add frontend/src-tauri/src/integrations/calendar frontend/src-tauri/src/lib.rs frontend/src/services/calendarContextService.ts
git commit -m "feat(calendar): expose calendar context commands"
```

---

### Task 5: Meeting Details UI

**Files:**
- Create: `frontend/src/components/MeetingDetails/CalendarContextPanel.tsx`
- Create: `frontend/src/components/MeetingIntegrations/CalendarContextButton.tsx`
- Modify: `frontend/src/app/meeting-details/page-content.tsx`
- Modify: `frontend/src/components/MeetingDetails/SummaryPanel.tsx`
- Modify: `frontend/src/components/MeetingDetails/SummaryMoreActions.tsx`

- [ ] **Step 1: Create context panel**

Create `CalendarContextPanel.tsx`:

```tsx
"use client";

import { CalendarDays, Mail, MapPin, Users } from "lucide-react";
import { CalendarContext } from "@/services/calendarContextService";

export function CalendarContextPanel({ context }: { context: CalendarContext | null }) {
  if (!context) return null;

  const starts = context.starts_at ? new Date(context.starts_at) : null;
  const attendeeLabel = context.attendees.length === 1 ? "1 participant" : `${context.attendees.length} participants`;

  return (
    <section className="border-b border-gray-100 px-4 py-3">
      <div className="flex items-start gap-3 text-sm">
        <CalendarDays className="mt-0.5 h-4 w-4 text-blue-600" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 truncate">{context.calendar_title || "Calendar event"}</div>
          {starts && <div className="text-xs text-gray-500">{starts.toLocaleString()}</div>}
          {context.organizer_name && <div className="mt-1 text-xs text-gray-600">Organizer: {context.organizer_name}</div>}
          {context.location && (
            <div className="mt-1 flex items-center gap-1 text-xs text-gray-600">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{context.location}</span>
            </div>
          )}
          <div className="mt-2 flex items-center gap-1 text-xs text-gray-600">
            <Users className="h-3 w-3" />
            <span>{attendeeLabel}</span>
          </div>
          {context.attendees.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {context.attendees.slice(0, 8).map((attendee, index) => (
                <span key={`${attendee.email || attendee.name || index}`} className="inline-flex max-w-48 items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700">
                  {attendee.email && <Mail className="h-3 w-3 text-gray-400" />}
                  <span className="truncate">{attendee.name || attendee.email || "Participant"}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create attach/change button**

Create `CalendarContextButton.tsx` with a popover that:

1. Calls `permissionStatus`.
2. Requests access if needed.
3. Loads events from the meeting day.
4. Calls `attachEvent` for the selected event.
5. Calls `onContextChanged` with the saved context.

Use `CalendarPlus`, `Loader2`, and `Check` icons from lucide.

- [ ] **Step 3: Wire context into page content**

In `page-content.tsx`, add:

```tsx
const [calendarContext, setCalendarContext] = useState<CalendarContext | null>(null);

useEffect(() => {
  let cancelled = false;
  calendarContextService.getMeetingContext(meeting.id)
    .then((context) => { if (!cancelled) setCalendarContext(context); })
    .catch((error) => console.warn("Failed to load calendar context", error));
  return () => { cancelled = true; };
}, [meeting.id]);
```

Pass `calendarContext` and `setCalendarContext` into `SummaryPanel`.

- [ ] **Step 4: Render panel and action**

In `SummaryPanel.tsx`, add props:

```ts
calendarContext: CalendarContext | null;
onCalendarContextChange: (context: CalendarContext | null) => void;
```

Render `<CalendarContextPanel context={calendarContext} />` above the summary body.

In `SummaryMoreActions.tsx`, add:

```tsx
<CalendarContextButton
  meetingId={meetingId}
  meetingCreatedAt={meetingCreatedAt}
  onContextChanged={onCalendarContextChange}
/>
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm run build
```

Commit:

```bash
git add frontend/src/components/MeetingDetails/CalendarContextPanel.tsx frontend/src/components/MeetingIntegrations/CalendarContextButton.tsx frontend/src/app/meeting-details/page-content.tsx frontend/src/components/MeetingDetails/SummaryPanel.tsx frontend/src/components/MeetingDetails/SummaryMoreActions.tsx
git commit -m "feat(calendar): attach calendar context in meeting details"
```

---

### Task 6: Recording Start Auto-Match

**Files:**
- Modify: `frontend/src/hooks/useRecordingStart.ts`
- Modify: `frontend/src/services/calendarContextService.ts`

- [ ] **Step 1: Add a service helper for nearby events**

Add:

```ts
export function recordingWindow(now = new Date()): { start: string; end: string } {
  return {
    start: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
    end: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
  };
}
```

- [ ] **Step 2: Use calendar title before recording**

In `useRecordingStart.ts`, before calling `recordingService.startRecordingWithDevices`, attempt:

```ts
const window = recordingWindow();
const events = await calendarContextService.findEvents(window.start, window.end);
const calendarTitle = events.length === 1 ? events[0].calendar_title : null;
const effectiveMeetingName = calendarTitle || meetingTitle;
```

Pass `effectiveMeetingName` into recording start. If Calendar permission is denied or the command fails, log a warning and keep the existing `meetingTitle`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
cd frontend && pnpm exec tsc --noEmit
```

Commit:

```bash
git add frontend/src/hooks/useRecordingStart.ts frontend/src/services/calendarContextService.ts
git commit -m "feat(calendar): use calendar title when starting recordings"
```

---

### Task 7: Summary Prompt, Cache, Export, And UpNote

**Files:**
- Modify: `frontend/src-tauri/src/summary/service.rs`
- Modify: `frontend/src-tauri/src/summary/processor.rs`
- Modify: `frontend/src/hooks/meeting-details/useSummaryGeneration.ts`
- Modify: `frontend/src/hooks/meeting-details/useCopyOperations.ts`
- Modify: `frontend/src-tauri/src/analytics/analytics.rs`

- [ ] **Step 1: Add summary prompt tests**

In `summary/processor.rs`, add a test that builds final prompt context and asserts it includes:

```rust
assert!(prompt.contains("Calendar context:"));
assert!(prompt.contains("Participants: Jane Doe <jane@example.com>"));
assert!(prompt.contains("Do not invent attendance"));
```

- [ ] **Step 2: Add analytics sanitizer test**

Extend `analytics_properties_drop_sensitive_meeting_metadata` with:

```rust
properties.insert("calendar_title".to_string(), "Client Strategy".to_string());
properties.insert("attendee_email".to_string(), "jane@example.com".to_string());
properties.insert("organizer_email".to_string(), "organizer@example.com".to_string());
properties.insert("calendar_notes".to_string(), "Confidential agenda".to_string());
```

Assert those keys are absent from the sanitized output.

- [ ] **Step 3: Implement summary context formatting**

Add a formatter that returns an empty string when there is no context and otherwise returns:

```text
Calendar context:
Title: Client Strategy
Organizer: Organizer <organizer@example.com>
Participants: Jane Doe <jane@example.com>
Scheduled time: 2026-07-14T18:00:00Z to 2026-07-14T18:30:00Z
Location or link: https://meet.example.com
Invite notes: Discuss launch plan

Use calendar context for names and roles. Do not invent attendance, decisions, or action items that are not supported by the transcript.
```

Append this block inside the existing `User Provided Context` region passed to `api_process_transcript`, or fetch it inside `SummaryService` before calling `generate_meeting_summary`.

- [ ] **Step 4: Include context in cache source**

Include a stable JSON or text fingerprint of calendar context in `build_summary_cache_source`. A context change must invalidate cached summaries.

- [ ] **Step 5: Include context in Markdown copy/export**

In `useCopyOperations.ts`, load `calendarContext` through props and add a section after frontmatter/header:

```md
## Calendar Context

- Organizer: Organizer <organizer@example.com>
- Scheduled: July 14, 2026, 2:00 PM - 2:30 PM
- Participants: Jane Doe <jane@example.com>
- Location or link: https://meet.example.com
```

Because UpNote sync uses the exported/generated meeting content path, this section becomes available to UpNote without moving routing logic into the calendar integration.

- [ ] **Step 6: Verify and commit**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib summary::processor -- --nocapture
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib analytics::analytics::tests::analytics_properties_drop_sensitive_meeting_metadata -- --nocapture
cd frontend && pnpm exec tsc --noEmit
```

Commit:

```bash
git add frontend/src-tauri/src/summary frontend/src-tauri/src/analytics/analytics.rs frontend/src/hooks/meeting-details/useSummaryGeneration.ts frontend/src/hooks/meeting-details/useCopyOperations.ts
git commit -m "feat(calendar): include calendar context in summaries and exports"
```

---

### Task 8: End-To-End Verification

**Files:**
- No source files unless verification reveals defects.

- [ ] **Step 1: Run full Rust calendar tests**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib integrations::calendar -- --nocapture
```

Expected: all calendar tests pass.

- [ ] **Step 2: Run privacy regression**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib analytics::analytics::tests::analytics_properties_drop_sensitive_meeting_metadata -- --nocapture
```

Expected: sanitizer test passes and removes calendar-sensitive fields.

- [ ] **Step 3: Run frontend type and build checks**

Run:

```bash
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm run build
```

Expected: TypeScript and Next export pass.

- [ ] **Step 4: Manual Calendar QA**

Run:

```bash
cd frontend && pnpm run tauri:dev
```

Manual checks:

1. Grant Calendar access when prompted.
2. Create or use a real Apple Calendar event with title, participants, notes, location, and link.
3. Start recording within the event window.
4. Confirm Meetily uses the calendar title or offers a visible attach action.
5. Stop recording and open meeting details.
6. Confirm participant names and optional emails appear in the calendar panel.
7. Generate a summary and confirm names are available without fabricated attendance.
8. Export Markdown and confirm the Calendar Context section appears.
9. Sync to UpNote and confirm the context appears while routing/duplicate behavior remains unchanged.

- [ ] **Step 5: Final commit if QA fixes were needed**

If QA required fixes:

```bash
git add <changed-files>
git commit -m "fix(calendar): harden calendar context integration"
```

If no fixes were needed, do not create an empty commit.
