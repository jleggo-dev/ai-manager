# Cadence Privacy Policy

**Effective date:** `[EFFECTIVE_DATE]`

**Product:** Cadence — [https://cadence.builders](https://cadence.builders)  
**Operator:** `[LEGAL_ENTITY_NAME]` (“Cadence,” “we,” “us,” or “our”)  
**Privacy contact:** `[PRIVACY_EMAIL]`  
**Mailing address:** `[PHYSICAL_ADDRESS]`

This Privacy Policy explains what information Cadence collects, how we use it, and the choices
you have. Cadence is a **coach**, not a clinic. We remember what you tell us so we can help you
keep a rhythm — and we try to be clear about what that remembering involves.

This policy is written for a US-primary audience. If you use Cadence from outside the United
States, see [International transfers](#11-international-transfers).

---

## 1. Who this applies to

This policy applies to the Cadence web app and API at cadence.builders and related services we
operate. It does not cover third-party sites or apps that link to Cadence (for example Google’s
sign-in screens, or Open Food Facts’ public catalog).

Cadence is intended for adults. We do not knowingly collect personal information from children
under 13. See also our Terms of Service (recommended 18+).

---

## 2. Information we collect

We collect information you provide, information created as you use the coach, and limited
technical data needed to run the service.

### 2.1 Account and identity

- **Email address** and authentication credentials via **Supabase Auth** (email/password and
  **Google OAuth**).
- Your email is also stored on your Cadence user record so we can associate coaching data with
  your login.

### 2.2 Profile and coaching context

Depending on what you share and confirm, this may include:

- **Name** (display / how the coach addresses you)
- **Baseline** details such as age, height, weight, constraints (“what we work around”), and
  preferences
- **Timezone**
- **Dietary profile** and **macro targets**
- **Streaks** and **points** (momentum / rewards state — hearth, not scoreboard)
- **Goals**, **plans**, **occurrences** (scheduled tasks), **session logs**, **check-ins**, and
  **episodes** (detours when life happens)

We aim to **confirm before we commit** important plan changes — the coach asks; it should not
silently lock in a new rhythm without your say-so.

### 2.3 Food and nutrition

- Nutrition logs, recipes, meal plans, and a foods cache used to speed up logging
- Photos you upload for meals, labels, or fridge inventory, stored in a **private** object store
  bucket (`meal-photos`)
- Barcode lookups: the browser may call **Open Food Facts**; results can be cached via our API
- Nutrient reference data from **USDA** sources accessed **server-side**

Food and body-related data can be sensitive. We treat it as personal and, where applicable,
consumer health–adjacent information (see our [Consumer Health Data Notice](./CONSUMER-HEALTH-DATA-NOTICE.md)).

### 2.4 Location (optional, minimized)

- You may optionally share a **coarse home location** (GPS coordinates and/or a city-style
  label) so we can personalize context such as local weather.
- Weather is fetched **server-side** via **OpenWeatherMap** using that saved location — we do
  not need continuous GPS tracking for the coach to work.
- You can clear location from Settings when that control is available.

### 2.5 Coach conversations and AI context

- Chat **messages** and **context packs** (summaries and structured memory the product builds
  so you do not have to repeat yourself)
- These are processed through our AI pipeline (**AI Admin**, in-process with Cadence) and
  sent to **LLM providers** (for example models from Anthropic/Claude, OpenAI/GPT, or
  Google/Gemini via our provider stack such as Devs.ai) so the coach can reply
- Certain **vision** jobs receive **time-limited signed URLs** to your meal/fridge photos so a
  model can look at an image you uploaded — not a public permanent link

AI can err. Please double-check what the coach says, especially anything health- or
safety-related.

### 2.6 Technical and operational data

- Standard server and hosting logs needed to operate, secure, and debug the service
- We host the web app and API on **Vercel**

We have **not** integrated third-party marketing analytics packages (for example consumer
ad/retargeting SDKs) as part of the current product. If that changes, we will update this
policy.

We do **not** sell your personal information for money, and we do not run Cadence as an
ad-supported data marketplace.

---

## 3. How we use information

We use your information to:

- Create and secure your account
- Provide coaching: remember context, build and bend plans, log food and sessions, show
  progress (including streaks/points)
- Run AI features (chat, vision, structured jobs) through our providers
- Fetch weather and similar situational context when you have shared a home location
- Improve reliability and safety (debugging, abuse prevention, crisis-boundary behavior in
  the coach persona)
- Respond to your privacy or support requests
- Comply with law

We do **not** use your coaching content to target third-party advertising.

---

## 4. How we share information

We share information only as needed to operate Cadence:

| Recipient | Why |
|---|---|
| **Supabase** | Authentication, database, and private photo storage |
| **Vercel** | Hosting web and API |
| **AI Admin / LLM providers** (e.g. via Devs.ai — Claude, GPT, Gemini classes) | Coach chat, context processing, vision jobs |
| **OpenWeatherMap** | Weather for your optional home location (server-side) |
| **USDA / Open Food Facts** | Nutrient and barcode reference data (USDA server-side; Open Food Facts may be hit from the browser, with API caching) |
| **Service providers** | Infrastructure and tooling under contracts that limit use to providing services to us |
| **Legal / safety** | If required by law, or to protect rights, safety, or integrity of the service |

Providers process data on our instructions to deliver the feature. Their own privacy terms also
apply to their processing.

We do not sell personal information. We do not share personal information for cross-context
behavioral advertising in the sense of a paid ad network built into Cadence today.

---

## 5. Photos and signed URLs

Meal, label, and fridge photos live in a **private** storage bucket. When a vision feature needs
to analyze a photo, our systems generate a **signed URL** with a limited lifetime for the model
provider. Treat photo uploads as potentially sensitive; only upload what you are comfortable
sharing with the coaching pipeline.

---

## 6. Retention

We keep your information while your account is active and as needed to provide Cadence, unless
you erase coaching data (see below) or we delete it under our retention practices.

Operational logs are kept for a limited period for security and reliability.

AI providers may retain prompts/outputs according to their agreements with us; we configure and
contract for service delivery, not for training Cadence as a public dataset broker. Exact
provider retention varies — ask `[PRIVACY_EMAIL]` if you need details for a specific request.

---

## 7. Your choices and rights

### 7.1 Access and export

Cadence does **not** currently offer a self-serve data-export API. To request a copy of personal
information we hold about you, or to ask what we process, email **`[PRIVACY_EMAIL]`**. Export
fulfillment may be **limited or manual** until a dedicated export feature ships — we will tell
you what we can provide and on what timeline.

### 7.2 Correction

You can update much of your profile and preferences in the app (Settings and coaching flows).
For corrections we cannot make in-product, contact `[PRIVACY_EMAIL]`.

### 7.3 “Start over” (erase coaching data — not full account deletion)

In Settings, **Start over** (`DELETE /me/data`) is designed to wipe **Cadence coaching data**
associated with your user — for example goals, plans, logs, recipes, meal photos (best-effort),
chat/provider conversation data we purge, baseline and dietary profile fields that the reset
clears — so you can begin again without repeating an old plan.

**Important current behavior:**

- This is **not** full **account deletion**. Your **login** (Supabase Auth) **survives**; you can
  still sign in with the same email/Google account.
- Some account-level fields may **not** clear today (for example **email**, and depending on
  version **home location**, **timezone**, and **points** state). Treat Start over as “erase my
  coaching memory and plan so I can rebuild,” not “delete my entire account and every residual
  field.”
- For a complete account closure or residual-field cleanup beyond Start over, contact
  **`[PRIVACY_EMAIL]`** (or `[SUPPORT_EMAIL]` for product help). We will work with you in good
  faith; timelines depend on auth-provider and backup constraints.

### 7.4 Location

Share, update, or clear home location when Settings offers those controls; or ask us at
`[PRIVACY_EMAIL]`.

### 7.5 Marketing

We do not operate Cadence as an ads product. If we ever send optional product emails beyond
transactional auth mail, we will provide an unsubscribe where required.

### 7.6 US state privacy rights

Depending on where you live (for example California under CCPA/CPRA, or other state laws), you
may have rights to know, access, delete, correct, or appeal certain decisions, and to opt out of
“sale” or “sharing” as those terms are defined by law. **We do not sell personal information for
money.** To exercise rights, email `[PRIVACY_EMAIL]`. We will not discriminate against you for
exercising privacy rights.

Sensitive or consumer health–related categories (nutrition, body metrics, mind-adjacent
coaching content) are described further in the [Consumer Health Data Notice](./CONSUMER-HEALTH-DATA-NOTICE.md).

---

## 8. Security

We use industry-standard measures appropriate to a hosted coach app: encrypted transport (HTTPS),
private storage for photos, authenticated API access, and access controls on our systems. No
method of transmission or storage is 100% secure. Please use a strong password and protect your
devices.

**Cadence is not a HIPAA-covered entity** for this consumer coach product, and this policy does
**not** claim HIPAA compliance.

---

## 9. Children

Cadence is not directed at children under 13, and we do not knowingly collect their personal
information. If you believe a child has provided data, contact `[PRIVACY_EMAIL]` and we will
take appropriate steps to delete it. Our Terms recommend **18+** because the product includes an
AI coach and mind-adjacent content.

---

## 10. AI, health, and crisis (privacy-relevant honesty)

- The coach is **AI** and can make mistakes — double-check important guidance.
- Cadence is **not** medical care, dietary prescription, psychotherapy, or crisis intervention.
- If you are in acute crisis in the US, call or text **988**; elsewhere, use your local emergency
  or crisis line. Do not rely on the coach in an emergency.

We may process crisis-related messages only as needed to apply safety boundaries (for example
stopping coaching and pointing to help). That processing still goes through our AI pipeline as
described above.

---

## 11. International transfers

Cadence is operated from the United States. If you access the service from another country, your
information may be processed in the US and in other countries where our processors (hosting, auth,
AI providers) operate. Those countries may have different data-protection laws than your home
jurisdiction. Where required, we rely on appropriate transfer mechanisms under applicable law.

---

## 12. Changes

We may update this policy as the product changes. We will post the updated version with a new
effective date. Material changes may also be called out in-app or by email when appropriate. Your
continued use after the effective date means you accept the updated policy.

---

## 13. Contact

Privacy requests: **`[PRIVACY_EMAIL]`**  
Support: **`[SUPPORT_EMAIL]`**  
Mail: **`[PHYSICAL_ADDRESS]`**  
Web: [https://cadence.builders](https://cadence.builders)

---

*Draft for counsel review. Not legal advice. Placeholders must be filled before publication.*
