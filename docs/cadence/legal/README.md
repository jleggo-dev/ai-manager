# Cadence — Legal drafts

Draft Privacy Policy, Terms of Service, and related notices for the Cadence product at
[https://cadence.builders](https://cadence.builders).

These documents describe current product behavior as of the draft date. They are **working
drafts for counsel**, not published legal advice, and they are **not** a substitute for review
by a qualified attorney before you publish them on the live site or in an app store listing.

## Status

| Doc | Purpose |
|---|---|
| [PRIVACY-POLICY.md](./PRIVACY-POLICY.md) | What we collect, why, who we share with, rights, retention |
| [TERMS-OF-SERVICE.md](./TERMS-OF-SERVICE.md) | Account rules, AI/coach disclaimers, liability, governing law |
| [CONSUMER-HEALTH-DATA-NOTICE.md](./CONSUMER-HEALTH-DATA-NOTICE.md) | Short WA/NV/CT-style appendix for sensitive wellness data |

**In-app routes:** cadence-web does not yet have a static `/privacy` or `/terms` route pattern.
Keep these markdown sources of truth here; wire Auth/Settings links to hosted pages in a
follow-up once counsel fills placeholders and the site serves them.

## Placeholders counsel must fill

Replace every bracketed token before publishing:

| Placeholder | Meaning |
|---|---|
| `[LEGAL_ENTITY_NAME]` | Legal operator of Cadence (LLC / Inc. / individual d/b/a) |
| `[PHYSICAL_ADDRESS]` | Registered or principal business address |
| `[PRIVACY_EMAIL]` | Inbox for privacy / access / deletion / CHD requests |
| `[SUPPORT_EMAIL]` | General product support inbox |
| `[GOVERNING_LAW_STATE]` | US state whose law governs the Terms |
| `[EFFECTIVE_DATE]` | Date these policies take effect when published |

Do **not** invent company names or email addresses in-repo until they are real.

## Not legal advice

- These drafts reflect engineering research (auth, storage, AI providers, “Start over,” etc.).
- They do **not** claim HIPAA coverage, full account deletion where the product only erases
  coaching data, data sales, or marketing analytics we do not run.
- Counsel should adapt for CCPA/CPRA, state consumer health data laws, GDPR/UK GDPR if you
  serve those users, and any future native-app store requirements.

## Brand alignment

Tone stays plain and warm (coach, not clinic; hearth, not scoreboard) while staying legally
clear. Confirm-before-commit and crisis boundaries already live in product copy and the coach
persona; the policies should match that honesty, not overclaim.
