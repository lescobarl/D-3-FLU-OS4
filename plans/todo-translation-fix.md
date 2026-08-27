# Todo: Fix Multi-Turn Translation Issue

## Phase 1: Strengthen Translation Override Instructions
- [ ] **Analyze current `buildTranslationOverrideBlock()` function** in `src/voice/lib/gemini.js`
- [ ] **Design stronger override instructions** with more authoritative language
- [ ] **Implement new override text** that forces model to produce only translation
- [ ] **Test the new override** with validation script

## Phase 2: Context Management Strategy
- [ ] **Evaluate conversation history impact** on translation turns
- [ ] **Design context cleaning approach** (if needed)
- [ ] **Implement history filtering** for translation intent
- [ ] **Test multi-turn scenarios** with cleaned context

## Phase 3: Validation and Testing
- [ ] **Update validation script** to detect explanatory text
- [ ] **Run comprehensive tests** for all language pairs
- [ ] **Verify no regressions** in normal conversation flow
- [ ] **Test edge cases** (empty responses, already in target language)

## Phase 4: Integration and Deployment
- [ ] **Update unit tests** in `tests/translationIntent.test.ts`
- [ ] **Run full test suite** to ensure no breaking changes
- [ ] **Deploy changes** and monitor real-world performance
- [ ] **Document the fix** for future reference

## Critical Success Criteria
- [ ] **User says "traduce a español lo que hablaste"** → FLU responds ONLY with Spanish translation
- [ ] **No explanatory text** like "Claro, con gusto traduciré..."
- [ ] **No meta-commentary** or questions added
- [ ] **Works for all language pairs** (zh→es, en→es, es→zh, etc.)
- [ ] **Normal conversation unaffected** - language switching still works

## Files to Modify
1. `src/voice/lib/gemini.js` - `buildTranslationOverrideBlock()` function
2. `src/voice/lib/gemini.js` - `generateFluContract()` function (optional context cleaning)
3. `scripts/validate-multiturn-translation.mjs` - Update validation patterns
4. `tests/translationIntent.test.ts` - Update unit tests

## Immediate Next Steps
1. Switch to Code mode to implement the strengthened override
2. Test with validation script
3. Iterate based on results