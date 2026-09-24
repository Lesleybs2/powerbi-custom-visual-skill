# Contributing

Thanks for helping other Power BI developers skip the traps.

## What makes a good addition

Every entry in `SKILL.md` has three parts:

1. **The rule**: what to do, in one sentence.
2. **The reason**: what goes wrong otherwise, with the exact error or symptom when there is one.
3. **The fix**: code, a setting or a version, small enough to copy.

Only add what you have seen happen in a real visual. Guesses and "should work" advice make the guide less
trustworthy for everyone.

## How

- **A trap or a correction**: open an issue with the symptom, the Power BI Desktop version, and the
  `powerbi-visuals-api` and `powerbi-visuals-tools` versions. Or open a pull request against `SKILL.md`.
- **A version that no longer works**: say which package, which version broke, and which one works.
- Keep the tone of the guide: plain words, no internal shorthand, units in the text.

## Before a pull request

- `claude plugin validate .` passes.
- The skill still loads: `npx skills add ./ --list` shows `create-powerbi-custom-visual`.
- Bump `version` in `.claude-plugin/marketplace.json` and `plugins/powerbi-custom-visual/.claude-plugin/plugin.json` together.
