/**
 * Project Nexus - Work Engine Priority Scoring Engine
 * Computes multi-factor attention scores based on urgency, business value, customer tier, and risk.
 */
export class PriorityService {
  /**
   * Computes a normalized 0-100 priority score for an item.
   */
  static calculatePriorityScore({
    dueDate = null,
    dealValue = 0,
    accountTier = 'SMB',
    healthScore = 100,
    leadScore = 0,
    itemType = 'TASK',
    isPendingApproval = false,
    activityType = null,
  }) {
    let score = 0;

    // Factor 1: Pending Human Approval (Top priority in System of Action)
    if (isPendingApproval) {
      score += 45;
    }

    // Factor 2: Urgency from Due Date
    if (dueDate) {
      const now = Date.now();
      const due = new Date(dueDate).getTime();
      const hoursRemaining = (due - now) / (1000 * 60 * 60);

      if (hoursRemaining < 0) {
        // Overdue!
        score += 40;
      } else if (hoursRemaining <= 24) {
        // Due today
        score += 30;
      } else if (hoursRemaining <= 72) {
        // Due within 3 days
        score += 20;
      } else if (hoursRemaining <= 168) {
        // Due this week
        score += 10;
      } else {
        score += 5;
      }
    }

    // Factor 3: Business Impact (Deal Value & Account Tier)
    if (dealValue > 100000) {
      score += 25;
    } else if (dealValue > 25000) {
      score += 15;
    } else if (dealValue > 5000) {
      score += 10;
    }

    if (accountTier === 'ENTERPRISE') {
      score += 20;
    } else if (accountTier === 'MID_MARKET') {
      score += 10;
    } else {
      score += 5;
    }

    // Factor 4: Customer Risk (Lower health score increases priority)
    if (healthScore < 50) {
      score += 25;
    } else if (healthScore < 75) {
      score += 15;
    }

    // Factor 5: Lead Scoring
    if (leadScore >= 80) {
      score += 20;
    } else if (leadScore >= 50) {
      score += 10;
    }

    // Factor 6: Activity Type
    if (activityType === 'CALL') {
      score += 5;
    } else if (activityType === 'MEETING') {
      score += 10;
    }

    // Clamp score to 1-100
    const finalScore = Math.min(Math.max(Math.round(score), 5), 100);

    let priorityTier = 'LOW';
    if (finalScore >= 80) {
      priorityTier = 'CRITICAL';
    } else if (finalScore >= 60) {
      priorityTier = 'HIGH';
    } else if (finalScore >= 40) {
      priorityTier = 'MEDIUM';
    }

    return {
      score: finalScore,
      priorityTier,
    };
  }

  static calculatePriority(options = {}) {
    return this.calculatePriorityScore(options);
  }
}
