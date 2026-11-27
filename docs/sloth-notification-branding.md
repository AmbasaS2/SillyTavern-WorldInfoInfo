# Sloth notification branding (1.7.1-ambasa.10)

- Baseline: 7aaac019c3051e06d44b36c64357c98c5a96156f
- Scope: 1 existing toast emission sites; preserve all messages, severity, return values and options. Prefix extension-specific console emissions; no global toastr override, polling, UI CSS, data or prompt changes.
- Title: 🦥 WorldInfo Info (Korean: 🦥 월드인포인포).
- Verification: source syntax parsed after stripping imports and substituting import.meta for parser-only validation, emission count and all title sites checked, locale title checks passed. Real SillyTavern desktop/mobile and full repository tests not run in this environment.
- Rollback: revert this commit (previous version 1.7.1-ambasa.9).
