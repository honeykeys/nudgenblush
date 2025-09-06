import dotenv from 'dotenv';
import { OpenAIService } from './integrations/openai';
import { WeaviateService } from './integrations/weaviate';
import { DemoMode } from './core/demo';
import { StoryCreationEngine } from './engines/story';

dotenv.config();

async function runDemo() {
  // Initialize services
  const openai = new OpenAIService(process.env.OPENAI_API_KEY!);
  const weaviate = new WeaviateService(process.env.WEAVIATE_URL!, process.env.WEAVIATE_API_KEY!);
  
  try {
    // Initialize Weaviate schema
    console.log('Initializing Weaviate schema...');
    await weaviate.initializeSchema();
    
    // Create demo instance
    const demo = new DemoMode(openai, weaviate, ['Emma', 'Jake'], ['Sarah']);
    
    // Initialize with Ember vibe and "Previously..." line
    const previouslyLine = "Emma and Jake met at a coffee shop during a thunderstorm, sharing an umbrella and meaningful glances.";
    
    console.log('🌹 Starting Nudge & Blush Demo...');
    console.log('Vibe: Ember (slow-burn romance)');
    console.log('Characters: Emma & Jake (spotlight), Sarah (watcher)');
    console.log(`Previously: "${previouslyLine}"`);
    console.log('---');
    
    const context = await demo.initializeDemo(previouslyLine);
    console.log(`✨ Extracted tokens: ${context.extractedTokens.map(t => t.content).join(', ')}`);
    console.log('');
    
    // Run several demo exchanges
    const exchanges = [
      "Emma nervously adjusts her coffee cup",
      "Jake notices Emma's painting supplies",
      "A moment of awkward silence",
      "Emma mentions her art exhibition"
    ];
    
    for (let i = 0; i < exchanges.length; i++) {
      console.log(`📝 Exchange ${i + 1}: ${exchanges[i]}`);
      
      try {
        const result = await demo.processExchange(exchanges[i], "cozy coffee shop");
        
        console.log('💡 Suggestions:');
        result.suggestions.forEach((suggestion, index) => {
          console.log(`  ${index + 1}. [${suggestion.type.toUpperCase()}] ${suggestion.description}`);
          if (suggestion.oneStepPreview) {
            console.log(`     Preview: ${suggestion.oneStepPreview}`);
          }
          console.log(`     Score: ${suggestion.netScore.toFixed(2)} (Fresh: ${suggestion.freshnessScore.toFixed(2)}, Coherence: ${suggestion.coherenceCost.toFixed(2)})`);
          console.log(`     Rationale: ${suggestion.rationale.join(', ')}`);
        });
        
        console.log(`💕 Love Graph: ${result.gameState.loveGraphSummary}`);
        if (result.gameState.checkpoint) {
          console.log(`🎉 Checkpoint reached: ${result.gameState.checkpoint}`);
        }
        console.log(`⏱️  Time remaining: ${Math.round(result.timeRemaining / 1000)}s`);
        console.log('---');
        
      } catch (error) {
        console.error(`❌ Error in exchange ${i + 1}:`, error);
      }
    }
    
    // Get final summary
    const summary = await demo.getDemoSummary();
    console.log('🎯 Demo Summary:');
    console.log(`Success: ${summary.success}`);
    console.log(`Checkpoints: ${summary.checkpointsReached.join(', ') || 'None'}`);
    console.log(`Early recall delivered: ${summary.recallDelivered}`);
    console.log(`Final love graph: Attraction ${(summary.loveGraphProgress.attraction * 100).toFixed(0)}%, Trust ${(summary.loveGraphProgress.trust * 100).toFixed(0)}%, Tension ${(summary.loveGraphProgress.tension * 100).toFixed(0)}%, Comfort ${(summary.loveGraphProgress.comfort * 100).toFixed(0)}%`);
    
    // Validate acceptance criteria
    const criteria = demo.validateAcceptanceCriteria();
    console.log('');
    console.log('✅ Acceptance Criteria:');
    console.log(`- Ember vibe working: ${criteria.emberVibeWorking ? '✓' : '✗'}`);
    console.log(`- Recall within 3 exchanges: ${criteria.recallWithin3Exchanges ? '✓' : '✗'}`);
    console.log(`- Mutual spark within 10 exchanges: ${criteria.mutualSparkWithin10 ? '✓' : '✗'}`);
    console.log(`- Freshness/continuity suggestions: ${criteria.freshnessContinuitySuggestions ? '✓' : '✗'}`);
    console.log(`- Contradiction rate acceptable: ${criteria.contradictionRateAcceptable ? '✓' : '✗'}`);
    
  } catch (error) {
    console.error('❌ Demo failed:', error);
  }
}

// Test individual components
async function runTests() {
  console.log('🧪 Running component tests...\n');
  
  const openai = new OpenAIService(process.env.OPENAI_API_KEY!);
  const storyEngine = new StoryCreationEngine(openai);
  
  // Test vibes
  console.log('📚 Available Vibes:');
  storyEngine.getAllVibes().forEach(vibe => {
    console.log(`- ${vibe.name}: ${vibe.tone.substring(0, 100)}...`);
  });
  
  console.log('\n🎭 Ember Vibe System Prompt Preview:');
  const emberVibe = storyEngine.getVibe('ember')!;
  const systemPrompt = storyEngine.generateVibeSystemPrompt(emberVibe, 1);
  console.log(systemPrompt.substring(0, 300) + '...');
}

// Main execution
if (require.main === module) {
  const mode = process.argv[2] || 'demo';
  
  if (mode === 'test') {
    runTests().catch(console.error);
  } else {
    runDemo().catch(console.error);
  }
}