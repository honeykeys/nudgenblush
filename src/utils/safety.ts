import { SafetyResult, GameLine, NudgeCandidate } from '../types';
import { OpenAIService } from '../integrations/openai';

export class SafetyGuardian {
  private openai: OpenAIService;
  private unsafePatterns: RegExp[];
  private warningPatterns: RegExp[];

  constructor(openai: OpenAIService) {
    this.openai = openai;
    
    // Hard block patterns - instant rejection
    this.unsafePatterns = [
      /\b(?:under|minor|child|kid|teenage?r?)\b.*\b(?:sexual|romantic|intimate)\b/i,
      /\b(?:sexual|romantic)\b.*\b(?:under|minor|child|kid|teenage?r?)\b/i,
      /\b(?:rape|assault|abuse|violence)\b/i,
      /\b(?:non-?consensual|against.{1,10}will|forced|coerced)\b/i,
      /\b(?:explicit|graphic|hardcore|xxx)\b/i,
      /\b(?:penetrat|genital|orgasm|climax|ejaculat)\b/i,
      /\b(?:fuck|shit|damn|bitch|whore|slut)\b/i // Strong profanity
    ];

    // Warning patterns - requires additional review
    this.warningPatterns = [
      /\b(?:kiss|embrace|touch|caress|intimate)\b/i,
      /\b(?:passion|desire|lust|arousal)\b/i,
      /\b(?:bedroom|bed|shower|undress)\b/i,
      /\b(?:alcohol|drunk|intoxicated)\b/i
    ];
  }

  async validateContent(content: string): Promise<SafetyResult> {
    // First pass: Hard block patterns
    for (const pattern of this.unsafePatterns) {
      if (pattern.test(content)) {
        return {
          isSafe: false,
          reason: `Content contains prohibited material: ${pattern.source}`
        };
      }
    }

    // Second pass: OpenAI moderation
    const moderationResult = await this.openai.checkSafety(content);
    if (!moderationResult.isSafe) {
      return moderationResult;
    }

    // Third pass: PG-13 and consent guidelines
    const pg13Result = this.checkPG13Guidelines(content);
    if (!pg13Result.isSafe) {
      return pg13Result;
    }

    // Fourth pass: Warning patterns (log but don't block)
    for (const pattern of this.warningPatterns) {
      if (pattern.test(content)) {
        console.log(`Warning pattern detected in content: ${pattern.source}`);
        // Continue processing - these are warnings only
      }
    }

    return { isSafe: true };
  }

  private checkPG13Guidelines(content: string): SafetyResult {
    const lowerContent = content.toLowerCase();

    // Age verification
    const ageProblems = [
      'underage', 'minor', 'child', 'kid', 'high school', 'teenager',
      'under 18', 'seventeen', 'sixteen', 'fifteen'
    ];

    for (const problem of ageProblems) {
      if (lowerContent.includes(problem)) {
        return {
          isSafe: false,
          reason: 'Content may reference underage individuals'
        };
      }
    }

    // Consent issues
    const consentProblems = [
      'without permission', 'against their will', 'didn\'t want to',
      'said no', 'stop it', 'forced them', 'made them'
    ];

    for (const problem of consentProblems) {
      if (lowerContent.includes(problem)) {
        return {
          isSafe: false,
          reason: 'Content may contain non-consensual elements'
        };
      }
    }

    // Explicit content beyond PG-13
    const explicitTerms = [
      'naked', 'nude', 'strip', 'undressing', 'underwear',
      'bra', 'panties', 'aroused', 'erection', 'wet'
    ];

    let explicitCount = 0;
    for (const term of explicitTerms) {
      if (lowerContent.includes(term)) {
        explicitCount++;
      }
    }

    if (explicitCount >= 2) {
      return {
        isSafe: false,
        reason: 'Content exceeds PG-13 rating guidelines'
      };
    }

    return { isSafe: true };
  }

  async validateNudgeCandidate(candidate: NudgeCandidate): Promise<SafetyResult> {
    if (candidate.oneStepPreview) {
      return await this.validateContent(candidate.oneStepPreview);
    }
    return { isSafe: true };
  }

  async validateGameLine(line: GameLine): Promise<SafetyResult> {
    return await this.validateContent(line.text);
  }

  async sanitizeInput(userInput: string): Promise<string> {
    // Remove obvious injection attempts
    let sanitized = userInput
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Script tags
      .replace(/javascript:/gi, '') // JavaScript protocol
      .replace(/on\w+\s*=/gi, '') // Event handlers
      .replace(/\{\{.*?\}\}/g, '') // Template injection
      .trim();

    // Limit length
    if (sanitized.length > 1000) {
      sanitized = sanitized.substring(0, 1000);
    }

    return sanitized;
  }

  checkCharacterAge(characterDescription: string): SafetyResult {
    const lowerDesc = characterDescription.toLowerCase();
    
    const youngIndicators = [
      'teen', 'teenage', 'young', 'student', 'school', 
      'college freshman', 'high school', 'adolescent'
    ];

    const adultIndicators = [
      'adult', '18', '19', 'twenty', 'college senior',
      'graduate', 'professional', 'working', 'career'
    ];

    let youngScore = 0;
    let adultScore = 0;

    for (const indicator of youngIndicators) {
      if (lowerDesc.includes(indicator)) {
        youngScore++;
      }
    }

    for (const indicator of adultIndicators) {
      if (lowerDesc.includes(indicator)) {
        adultScore++;
      }
    }

    if (youngScore > adultScore) {
      return {
        isSafe: false,
        reason: 'Character may be underage - all characters must be 18+ adults'
      };
    }

    return { isSafe: true };
  }

  generateSafetyReport(content: string): {
    safetyScore: number; // 0-1, 1 = completely safe
    warnings: string[];
    blocked: boolean;
  } {
    const warnings: string[] = [];
    let safetyScore = 1.0;
    let blocked = false;

    // Check hard blocks
    for (const pattern of this.unsafePatterns) {
      if (pattern.test(content)) {
        blocked = true;
        safetyScore = 0;
        warnings.push(`Blocked: ${pattern.source}`);
        return { safetyScore, warnings, blocked };
      }
    }

    // Check warnings
    for (const pattern of this.warningPatterns) {
      if (pattern.test(content)) {
        safetyScore -= 0.1;
        warnings.push(`Warning: ${pattern.source}`);
      }
    }

    const pg13Result = this.checkPG13Guidelines(content);
    if (!pg13Result.isSafe) {
      blocked = true;
      safetyScore = 0;
      warnings.push(`Blocked: ${pg13Result.reason}`);
    }

    return {
      safetyScore: Math.max(0, safetyScore),
      warnings,
      blocked
    };
  }

  // Emergency stop - immediately halt story generation
  emergencyStop(reason: string): void {
    console.error(`EMERGENCY STOP: ${reason}`);
    throw new Error(`Story generation halted for safety: ${reason}`);
  }
}