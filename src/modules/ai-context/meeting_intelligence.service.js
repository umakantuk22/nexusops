/**
 * Project Nexus - AI Meeting Intelligence & Action Extraction Service
 * Extracts action items, sentiments, and automates task creation from transcripts.
 */
import { ActivityService } from '../crm/activity.service.js';
import { TimelineService } from '../crm/timeline.service.js';
import { AiContextService } from './context.service.js';
import { ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export class MeetingIntelligenceService {
  /**
   * Analyzes meeting notes/transcript, extracts commitments, and provisions tasks.
   */
  static async analyzeMeeting({
    organizationId,
    userId,
    entityType,
    entityId,
    meetingTitle,
    transcript,
  }) {
    if (!organizationId || !entityType || !entityId || !transcript) {
      throw new ValidationError('Organization ID, entityType, entityId, and transcript are required.');
    }

    // Sanitize untrusted external dialogue
    const sanitizedTranscript = AiContextService.sanitizeUntrustedContent(transcript);

    // Heuristic & NLP extraction engine
    const textLower = transcript.toLowerCase();
    
    // Sentiment Analysis
    let sentiment = 'NEUTRAL';
    if (textLower.includes('pricing is too high') || textLower.includes('competitor') || textLower.includes('frustrated') || textLower.includes('delay')) {
      sentiment = 'RISK_OF_CHURN';
    } else if (textLower.includes('love the product') || textLower.includes('ready to sign') || textLower.includes('approved') || textLower.includes('excited')) {
      sentiment = 'POSITIVE';
    }

    // Key Takeaways & Action Items Extraction
    const lines = transcript.split('\n').map((l) => l.trim()).filter(Boolean);
    const actionItems = [];

    for (const line of lines) {
      if (
        line.toLowerCase().startsWith('action:') ||
        line.toLowerCase().startsWith('todo:') ||
        line.toLowerCase().includes('will send') ||
        line.toLowerCase().includes('schedule follow-up') ||
        line.toLowerCase().includes('deliver')
      ) {
        actionItems.push(line.replace(/^(action:|todo:)/i, '').trim());
      }
    }

    // If no explicit markers found, create default follow-up action
    if (actionItems.length === 0) {
      actionItems.push(`Review notes and share summary with customer for '${meetingTitle || 'Meeting'}'`);
    }

    // Auto-create activities in CRM
    const createdActivities = [];
    for (const item of actionItems) {
      const task = await ActivityService.createActivity({
        organizationId,
        userId,
        entityType,
        entityId,
        type: 'TASK',
        subject: item.slice(0, 120),
        description: `Auto-extracted from meeting: "${meetingTitle || 'Sync'}". Raw Context: ${sanitizedTranscript.slice(0, 200)}...`,
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // Due in 48 hours
      });
      createdActivities.push(task);
    }

    // Record on Unified Customer Timeline
    await TimelineService.recordEvent({
      organizationId,
      entityType,
      entityId,
      eventType: 'MEETING_INTELLIGENCE_PROCESSED',
      summary: `Meeting '${meetingTitle || 'Customer Discussion'}' analyzed: Sentiment is ${sentiment}. ${actionItems.length} action items created.`,
      metadata: {
        sentiment,
        actionItemsCount: actionItems.length,
        extractedTasks: actionItems,
      },
    });

    logger.info('Meeting Intelligence Extracted', {
      organizationId,
      entityId,
      sentiment,
      tasksCreated: createdActivities.length,
    });

    return {
      meetingTitle: meetingTitle || 'Meeting Review',
      sentiment,
      actionItems,
      createdActivities,
    };
  }
}
