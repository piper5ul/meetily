import { useCallback, RefObject } from 'react';
import { Transcript, Summary } from '@/types';
import { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { tagService } from '@/services/tagService';

interface UseCopyOperationsProps {
  meeting: any;
  transcripts: Transcript[];
  meetingTitle: string;
  aiSummary: Summary | null;
  blockNoteSummaryRef: RefObject<BlockNoteSummaryViewRef>;
}

export function useCopyOperations({
  meeting,
  transcripts,
  meetingTitle,
  aiSummary,
  blockNoteSummaryRef,
}: UseCopyOperationsProps) {

  // Helper function to fetch ALL transcripts for copying (not just paginated data)
  const fetchAllTranscripts = useCallback(async (meetingId: string): Promise<Transcript[]> => {
    try {
      console.log('📊 Fetching all transcripts for copying:', meetingId);

      // First, get total count by fetching first page
      const firstPage = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: 1,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      const totalCount = firstPage.total_count;
      console.log(`📊 Total transcripts in database: ${totalCount}`);

      if (totalCount === 0) {
        return [];
      }

      // Fetch all transcripts in one call
      const allData = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: totalCount,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      console.log(`✅ Fetched ${allData.transcripts.length} transcripts from database for copying`);
      return allData.transcripts;
    } catch (error) {
      console.error('❌ Error fetching all transcripts:', error);
      toast.error('Failed to fetch transcripts for copying');
      return [];
    }
  }, []);

  const getSummaryMarkdown = useCallback(async (): Promise<string> => {
    let summaryMarkdown = '';

    if (blockNoteSummaryRef.current?.getMarkdown) {
      summaryMarkdown = await blockNoteSummaryRef.current.getMarkdown();
    }

    if (!summaryMarkdown && aiSummary && 'markdown' in aiSummary) {
      summaryMarkdown = (aiSummary as any).markdown || '';
    }

    if (!summaryMarkdown && aiSummary) {
      const sections = Object.entries(aiSummary)
        .filter(([key]) => {
          return key !== 'markdown' && key !== 'summary_json' && key !== '_section_order' && key !== 'MeetingName';
        })
        .map(([, section]) => {
          if (section && typeof section === 'object' && 'title' in section && 'blocks' in section) {
            const sectionTitle = `## ${section.title}\n\n`;
            const sectionContent = section.blocks
              .map((block: any) => `- ${block.content}`)
              .join('\n');
            return sectionTitle + sectionContent;
          }
          return '';
        })
        .filter(s => s.trim())
        .join('\n\n');
      summaryMarkdown = sections;
    }

    return summaryMarkdown;
  }, [aiSummary, blockNoteSummaryRef]);

  const buildSummaryMarkdownDocument = useCallback(async (exportedOnLabel: string): Promise<string | null> => {
    const summaryMarkdown = await getSummaryMarkdown();

    if (!summaryMarkdown.trim()) {
      return null;
    }

    const tags = await tagService.getMeetingTags(meeting.id);
    const tagNames = tags.map(tag => tag.name);
    const escapedTitle = String(meetingTitle || meeting.title || 'Untitled Meeting').replace(/"/g, '\\"');
    const meetingDate = new Date(meeting.created_at);

    const frontmatter = [
      '---',
      `title: "${escapedTitle}"`,
      `meeting_id: "${meeting.id}"`,
      `date: "${meetingDate.toISOString()}"`,
      `tags: [${tagNames.map(tag => `"${tag.replace(/"/g, '\\"')}"`).join(', ')}]`,
      tagNames[0] ? `upnote_notebook_hint: "${tagNames[0].replace(/"/g, '\\"')}"` : 'upnote_notebook_hint: ""',
      'source: "Meetily"',
      '---',
      '',
    ].join('\n');

    const header = `# Meeting Summary: ${meetingTitle}\n\n`;
    const metadata = `**Meeting ID:** ${meeting.id}\n**Date:** ${meetingDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}\n${tagNames.length ? `**Tags:** ${tagNames.join(', ')}\n` : ''}**${exportedOnLabel}:** ${new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}\n\n---\n\n`;

    return frontmatter + header + metadata + summaryMarkdown;
  }, [getSummaryMarkdown, meeting, meetingTitle]);

  const getExportPath = useCallback(async (): Promise<string> => {
    const safeTitle = String(meetingTitle || meeting.title || meeting.id || 'meeting-summary')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'meeting-summary';
    const fileName = `${safeTitle}.md`;

    if (meeting.folder_path) {
      return `${meeting.folder_path.replace(/\/$/, '')}/${fileName}`;
    }

    const { downloadDir, join } = await import('@tauri-apps/api/path');
    return join(await downloadDir(), fileName);
  }, [meeting, meetingTitle]);

  // Copy transcript to clipboard
  const handleCopyTranscript = useCallback(async () => {
    // CHANGE: Fetch ALL transcripts from database, not from pagination state
    console.log('📊 Fetching all transcripts for copying...');
    const allTranscripts = await fetchAllTranscripts(meeting.id);

    if (!allTranscripts.length) {
      const error_msg = 'No transcripts available to copy';
      console.log(error_msg);
      toast.error(error_msg);
      return;
    }

    console.log(`✅ Copying ${allTranscripts.length} transcripts to clipboard`);

    // Format timestamps as recording-relative [MM:SS] instead of wall-clock time
    const formatTime = (seconds: number | undefined, fallbackTimestamp: string): string => {
      if (seconds === undefined) {
        // For old transcripts without audio_start_time, use wall-clock time
        return fallbackTimestamp;
      }
      const totalSecs = Math.floor(seconds);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    };

    const header = `# Transcript of the Meeting: ${meeting.id} - ${meetingTitle ?? meeting.title}\n\n`;
    const date = `## Date: ${new Date(meeting.created_at).toLocaleDateString()}\n\n`;
    const fullTranscript = allTranscripts
      .map(t => `${formatTime(t.audio_start_time, t.timestamp)} ${t.text}  `)
      .join('\n');

    await navigator.clipboard.writeText(header + date + fullTranscript);
    toast.success("Transcript copied to clipboard");

    // Track copy analytics
    const wordCount = allTranscripts
      .map(t => t.text.split(/\s+/).length)
      .reduce((a, b) => a + b, 0);

    await Analytics.trackCopy('transcript', {
      meeting_id: meeting.id,
      transcript_length: allTranscripts.length.toString(),
      word_count: wordCount.toString()
    });
  }, [meeting, meetingTitle, fetchAllTranscripts]);

  // Copy summary to clipboard
  const handleCopySummary = useCallback(async () => {
    try {
      console.log('🔍 Copy Summary - Starting...');

      const fullMarkdown = await buildSummaryMarkdownDocument('Copied on');

      if (!fullMarkdown) {
        console.error('❌ No summary content available to copy');
        toast.error('No summary content available to copy');
        return;
      }

      await navigator.clipboard.writeText(fullMarkdown);

      console.log('✅ Successfully copied to clipboard!');
      toast.success("Summary copied to clipboard");

      // Track copy analytics
      await Analytics.trackCopy('summary', {
        meeting_id: meeting.id,
        has_markdown: (!!aiSummary && 'markdown' in aiSummary).toString()
      });
    } catch (error) {
      console.error('❌ Failed to copy summary:', error);
      toast.error("Failed to copy summary");
    }
  }, [aiSummary, meeting, buildSummaryMarkdownDocument]);

  const handleExportSummaryMarkdown = useCallback(async () => {
    try {
      const fullMarkdown = await buildSummaryMarkdownDocument('Exported on');

      if (!fullMarkdown) {
        toast.error('No summary content available to export');
        return;
      }

      const filePath = await getExportPath();
      await invokeTauri('save_transcript', {
        filePath,
        content: fullMarkdown,
      });

      toast.success('Markdown note exported', {
        description: filePath,
      });

      await Analytics.trackButtonClick('export_summary_markdown', 'meeting_details');
    } catch (error) {
      console.error('❌ Failed to export summary markdown:', error);
      toast.error('Failed to export markdown note');
    }
  }, [buildSummaryMarkdownDocument, getExportPath, meeting.id]);

  return {
    handleCopyTranscript,
    handleCopySummary,
    handleExportSummaryMarkdown,
  };
}
