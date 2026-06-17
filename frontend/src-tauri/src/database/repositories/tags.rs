use crate::database::models::{MeetingModel, TagModel};
use chrono::Utc;
use sqlx::{Error as SqlxError, SqlitePool};
use uuid::Uuid;

pub struct TagsRepository;

impl TagsRepository {
    pub async fn list_tags(pool: &SqlitePool) -> Result<Vec<TagModel>, SqlxError> {
        sqlx::query_as::<_, TagModel>(
            r#"
            SELECT
                tags.id,
                tags.name,
                tags.created_at,
                tags.updated_at,
                COUNT(meeting_tags.meeting_id) AS meeting_count
            FROM tags
            LEFT JOIN meeting_tags ON meeting_tags.tag_id = tags.id
            GROUP BY tags.id, tags.name, tags.created_at, tags.updated_at
            ORDER BY LOWER(tags.name) ASC
            "#,
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create_tag(pool: &SqlitePool, name: &str) -> Result<TagModel, SqlxError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(SqlxError::Protocol("tag name cannot be empty".to_string()));
        }

        let existing = sqlx::query_as::<_, TagModel>(
            r#"
            SELECT
                tags.id,
                tags.name,
                tags.created_at,
                tags.updated_at,
                COUNT(meeting_tags.meeting_id) AS meeting_count
            FROM tags
            LEFT JOIN meeting_tags ON meeting_tags.tag_id = tags.id
            WHERE LOWER(tags.name) = LOWER(?)
            GROUP BY tags.id, tags.name, tags.created_at, tags.updated_at
            "#,
        )
        .bind(trimmed)
        .fetch_optional(pool)
        .await?;

        if let Some(tag) = existing {
            return Ok(tag);
        }

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query("INSERT INTO tags (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(&id)
            .bind(trimmed)
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await?;

        Ok(TagModel {
            id,
            name: trimmed.to_string(),
            created_at: now.clone(),
            updated_at: now,
            meeting_count: 0,
        })
    }

    pub async fn get_meeting_tags(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<TagModel>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        sqlx::query_as::<_, TagModel>(
            r#"
            SELECT
                tags.id,
                tags.name,
                tags.created_at,
                tags.updated_at,
                (
                    SELECT COUNT(*)
                    FROM meeting_tags counts
                    WHERE counts.tag_id = tags.id
                ) AS meeting_count
            FROM tags
            INNER JOIN meeting_tags ON meeting_tags.tag_id = tags.id
            WHERE meeting_tags.meeting_id = ?
            ORDER BY LOWER(tags.name) ASC
            "#,
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn set_meeting_tags(
        pool: &SqlitePool,
        meeting_id: &str,
        tag_ids: Vec<String>,
    ) -> Result<Vec<TagModel>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut tx = pool.begin().await?;
        let meeting_exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(&mut *tx)
            .await?;

        if meeting_exists.is_none() {
            tx.rollback().await?;
            return Err(SqlxError::RowNotFound);
        }

        sqlx::query("DELETE FROM meeting_tags WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(&mut *tx)
            .await?;

        let now = Utc::now().to_rfc3339();
        for tag_id in tag_ids {
            let trimmed = tag_id.trim();
            if trimmed.is_empty() {
                continue;
            }

            sqlx::query(
                r#"
                INSERT OR IGNORE INTO meeting_tags (meeting_id, tag_id, created_at)
                SELECT ?, id, ? FROM tags WHERE id = ?
                "#,
            )
            .bind(meeting_id)
            .bind(&now)
            .bind(trimmed)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Self::get_meeting_tags(pool, meeting_id).await
    }

    pub async fn get_meetings_for_tag(
        pool: &SqlitePool,
        tag_id: &str,
    ) -> Result<Vec<MeetingModel>, SqlxError> {
        if tag_id.trim().is_empty() {
            return Err(SqlxError::Protocol("tag_id cannot be empty".to_string()));
        }

        sqlx::query_as::<_, MeetingModel>(
            r#"
            SELECT meetings.id, meetings.title, meetings.created_at, meetings.updated_at, meetings.folder_path
            FROM meetings
            INNER JOIN meeting_tags ON meeting_tags.meeting_id = meetings.id
            WHERE meeting_tags.tag_id = ?
            ORDER BY meetings.created_at DESC
            "#,
        )
        .bind(tag_id)
        .fetch_all(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::TagsRepository;
    use chrono::Utc;
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect in-memory database");

        sqlx::query(
            r#"
            CREATE TABLE meetings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                folder_path TEXT
            );
            CREATE TABLE tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE meeting_tags (
                meeting_id TEXT NOT NULL,
                tag_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (meeting_id, tag_id),
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&pool)
        .await
        .expect("create test schema");

        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind("meeting-a")
            .bind("Payzli Payment Integration")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("insert meeting a");
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind("meeting-b")
            .bind("Soul Bank Planning")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("insert meeting b");

        pool
    }

    #[tokio::test]
    async fn create_tag_trims_name_and_lists_with_zero_count() {
        let pool = test_pool().await;

        let tag = TagsRepository::create_tag(&pool, "  Payzli  ")
            .await
            .expect("create tag");
        assert_eq!(tag.name, "Payzli");
        assert_eq!(tag.meeting_count, 0);

        let tags = TagsRepository::list_tags(&pool).await.expect("list tags");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "Payzli");
        assert_eq!(tags[0].meeting_count, 0);
    }

    #[tokio::test]
    async fn assigning_tags_updates_meeting_tags_and_counts() {
        let pool = test_pool().await;
        let payzli = TagsRepository::create_tag(&pool, "Payzli")
            .await
            .expect("create payzli tag");
        let follow_up = TagsRepository::create_tag(&pool, "Follow-up")
            .await
            .expect("create follow up tag");

        TagsRepository::set_meeting_tags(
            &pool,
            "meeting-a",
            vec![payzli.id.clone(), follow_up.id.clone()],
        )
        .await
        .expect("set meeting tags");

        let meeting_tags = TagsRepository::get_meeting_tags(&pool, "meeting-a")
            .await
            .expect("get meeting tags");
        assert_eq!(
            meeting_tags
                .iter()
                .map(|tag| tag.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Follow-up", "Payzli"]
        );

        let tags = TagsRepository::list_tags(&pool).await.expect("list tags");
        assert_eq!(
            tags.iter()
                .map(|tag| (tag.name.as_str(), tag.meeting_count))
                .collect::<Vec<_>>(),
            vec![("Follow-up", 1), ("Payzli", 1)]
        );
    }

    #[tokio::test]
    async fn filtering_meetings_by_tag_returns_only_assigned_meetings() {
        let pool = test_pool().await;
        let payzli = TagsRepository::create_tag(&pool, "Payzli")
            .await
            .expect("create payzli tag");
        TagsRepository::set_meeting_tags(&pool, "meeting-a", vec![payzli.id.clone()])
            .await
            .expect("assign tag");

        let meetings = TagsRepository::get_meetings_for_tag(&pool, &payzli.id)
            .await
            .expect("filter meetings");

        assert_eq!(meetings.len(), 1);
        assert_eq!(meetings[0].id, "meeting-a");
        assert_eq!(meetings[0].title, "Payzli Payment Integration");
    }
}
