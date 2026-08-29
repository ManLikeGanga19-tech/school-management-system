# ShuleHQ — Marketing Site Redesign Brief (Figma)

**Purpose:** Replace the current templated/"AI-generated" marketing UI with a
restrained, enterprise-grade design — without changing the product's honest
positioning. Built to be executed **incrementally**: apply the Foundations
(Section D) once, then redesign **one screen at a time** (Section F).

**How to use this with Figma AI / Figma Make / a designer:** paste Sections
A–E first to establish the system, then paste a single screen block from
Section F per artboard. Keep the token names identical to the code so handoff
maps 1:1 (Section I).

---

## A. Product & audience context (get the tone right)

- **What it is:** ShuleHQ is a multi-tenant **school-operations SaaS for Kenyan
  schools** — enrollment, CBC assessments, finance/fees with M-Pesa receipts,
  attendance, and a parent portal. Each school runs on its own subdomain.
- **Who visits the marketing site:** school **directors, principals, bursars/
  secretaries, proprietors** — decision-makers evaluating a system of record for
  their institution. Not consumers, not developers.
- **Buying mindset:** trust, compliance, reliability, "will this survive an
  audit and make my staff's month-end easier." They respond to proof, clarity,
  and institutional seriousness — not hype.
- **Positioning pillars (real, never fabricate stats):** CBC & **KICD**-aligned
  assessments; **KEMIS/ULI**-ready learner records; instant **M-Pesa** fee
  receipts; parent communication; data protection (Kenya DPA 2019).
- **Brand feeling to land:** *calm, credible, modern African enterprise.*
  Warm but disciplined. Closer to Mercury/Ramp/Stripe restraint than to a
  gradient-heavy startup template.

## B. What to remove (the "AI-generated" fingerprints — audited)

Eliminate these across every screen:

1. **Oversized radii** — `rounded-[2rem]/[2.5rem]/[3rem]` blobs (18 uses). Cards
   should read as documents, not pills.
2. **Heavy shadows** — `shadow-2xl` everywhere (18). Depth should be subtle.
3. **Gradients + glow blobs** — decorative `bg-gradient`/`blur-3xl` orbs (15).
   Backgrounds should be flat, quiet surfaces.
4. **"*Italic accent word*" headlines** (22) — e.g. "Mastering the *CBC
   Framework*". Emphasis comes from **weight and color**, never italic.
5. **Pill/label-caps overload** (91) — tiny uppercase eyebrow tags on every
   block. Use at most one eyebrow per section, sparingly.
6. **Symmetric 3-card grids** as the default answer to every section.
7. **Fake placeholders** — `[Illustration: …]` and gray-bar "preview" mockups.
   Replace with **real product screenshots** or nothing.
8. **Tinted emoji-style icon tiles** — rainbow rounded squares behind each icon.

## C. Design principles (the target bar)

- **Reference caliber:** Stripe, Linear, Vercel, Ramp, Mercury. Study the
  restraint, not the palette.
- **Content-first:** type hierarchy and whitespace do the work; decoration is
  the exception, earns its place.
- **One accent.** Rust `#b9512d` is a spice, not a base. Most of the page is
  ink-on-cream with hairline structure.
- **Quiet surfaces:** flat backgrounds, hairline borders, at most one soft
  shadow level. Let the product screenshots be the color.
- **Real proof over adjectives:** live stats (already exposed at
  `/api/v1/public/stats`), real screenshots, KICD/KEMIS marks, one genuine
  client quote — nothing invented.
- **Purposeful motion:** 150–250ms ease-out, small translate/opacity reveals.
  No parallax, no bouncing.

## D. Foundations (design system — build as Figma variables/styles)

### D1. Color (keep the warm identity, impose discipline)
Roles (existing tokens in `globals.css` — reuse the names):

| Role | Token | Hex | Usage |
|---|---|---|---|
| Base surface | `page-bg` | `#fcfbf7` | page background |
| Raised surface | `white` | `#ffffff` | cards, nav |
| Warm surface | `warm-cream` / `light-sand` | `#f7f2e8` / `#efe3c8` | section banding only |
| Ink (primary text) | `dark-navy` | `#132129` | headings, body |
| Muted text | `muted-text` | `#66717b` | secondary copy |
| Border / hairline | `brand-border` | `#e2d4bf` | 1px dividers, card edges |
| **Primary accent** | `brand-primary` | `#b9512d` | primary CTA, key links — **sparingly** |
| Secondary accent | `deep-teal` | `#173f49` | dark sections, secondary marks |
| Success | `forest-green` | `#20644f` | positive states |
| Warning/legal | `amber-brown` | `#8b5a17` | notices |

Add a **neutral gray ramp** (50→900) for UI chrome (input borders, table rules,
disabled) so warm tints aren't overloaded for structural jobs. Verify **WCAG AA**
for every text/background pair (muted-text on cream is the one to check).

### D2. Typography
- **Display:** Plus Jakarta Sans. **Text:** Aptos / Inter fallback. (No italics.)
- **Scale (desktop / mobile):** Display 56/40 · H1 40/32 · H2 30/24 · H3 22/20 ·
  Body-lg 18/17 · Body 16 · Small 14 · Caption 12.
- **Weights:** 700 display headings, 600 sub-headings, 400–500 body.
- **Tracking:** headings `-0.02em`; eyebrow caption `+0.12em` uppercase (used
  rarely). Line-height: headings 1.1, body 1.6.

### D3. Spacing, grid, layout
- 4/8px spacing base. Container **max-width 1200px** (1280 for wide heroes),
  24px gutters, **12-column** grid.
- **Section rhythm:** 96–128px vertical on desktop, 64px mobile. Consistent,
  generous.

### D4. Radius, elevation, borders
- **Radius:** cards/inputs **12px**, buttons **8–10px**, tags/pills full only for
  small tags. **Retire 2–3rem.**
- **Elevation:** Level 0 = hairline border only. Level 1 = `0 1px 2px
  rgba(19,33,41,.06)`. Level 2 (hover/menus) = `0 8px 24px rgba(19,33,41,.08)`.
  Nothing heavier.

### D5. Iconography & imagery
- One icon set (Lucide), **1.5px stroke**, monochrome ink or single accent — no
  tinted rainbow tiles.
- **Imagery = real product screenshots** in a minimal browser/device frame, or
  authentic Kenyan-school photography. Remove all placeholder illustrations.
- **Trust marks:** KICD + KEMIS in a single quiet, height-balanced strip
  (KEMIS is a square badge, KICD a wide lockup — normalize by optical size).

### D6. Motion
- Enter: opacity 0→1 + translateY 8px, 200ms ease-out, stagger 60ms.
- Hover: 120ms. Respect `prefers-reduced-motion`.

### D7. Core components (build once, reuse)
Buttons (primary solid rust, secondary outline/ink, ghost); Text input & select;
Card (hairline + L1); Tag; Section eyebrow; Stat block; Logo strip; Testimonial;
CTA band (dark-navy or deep-teal, one per page); Pricing table; FAQ accordion;
Changelog timeline; Blog article card; Nav (desktop + mobile drawer); Footer.
Define default/hover/focus/disabled + light/dark-section variants for each.

## E. Global chrome

- **Navbar:** left logo (real ShuleHQ mark), center/left links (Features,
  Pricing, CBC Guide, Blog, About), right **View Demo** (ghost) + **Get Started
  for free** (primary → /contact). Sticky, transparent over hero → solid + 1px
  bottom border after scroll. Mobile: hamburger → full-height drawer. Height 64px.
- **Footer:** 4 columns (Product, Company, Resources, Legal) + brand block with
  the KICD/KEMIS "Aligned with" strip + contact. Bottom bar: © + Terms + Privacy.
  Dark-navy surface, hairline dividers, no gradients.

## F. Per-screen specs (redesign order — one artboard set each)

For each screen: **keep the real copy**, restructure for hierarchy, cut the tells.

### F1. Home / Landing (`/`)
- **Hero:** two-column. Left: H1 (one clear value line, no italics), one-sentence
  subhead, primary + secondary CTA, then the height-balanced KICD/KEMIS trust
  strip. Right: a **real product screenshot** in a clean browser frame (not a
  gradient card). Flat cream background.
- **Section: "One platform, built to the national standard"** — 4 capability
  cards (CBC, KEMIS/ULI, instant receipts, audit) as flat hairline cards with a
  small monochrome icon, no tinted tiles. Below: a single row of **live stats**
  (learners managed, schools) pulled from `/api/v1/public/stats`.
- **Feature deep-dives:** alternating left/right screenshot + copy rows (2–3),
  each anchored to a real module.
- **Proof:** one genuine client quote (Novel School) — plain, attributed, no
  fake avatars/ratings inflation.
- **Final CTA band:** dark surface, single headline + primary CTA (explore demo →
  go live). Then footer.

### F2. Features (`/features`)
- Overview hero (what the platform covers). Then **module sections** (Admissions/
  Enrollment, CBC Assessments, Finance & M-Pesa, Attendance, Parent Portal,
  Records/KEMIS) each as a screenshot + concise capability list. Kill the
  symmetric icon-grid; use real UI. Close with CTA band.

### F3. Pricing (`/pricing`)
- Clear plan **table** (hairline, not shadowed cards): tiers, what's included,
  per-student or per-school basis, M-Pesa note. Monthly/annual toggle if real.
- FAQ accordion (billing, onboarding, data ownership). CTA band. No neon
  "most popular" gradient — mark the recommended tier with a subtle accent border.

### F4. About (`/about`)
- Mission statement (one strong paragraph, no italic hero). Story/why-Kenya.
  Values as a restrained list (not 3 glossy cards). Optional team/founder.
  Standards & data-protection commitment. CTA.

### F5. CBC Guide (`/cbc-guide`)
- Editorial layout: sticky section nav + long-form content. Replace the
  `[Illustration: 7 competencies]` placeholder with a **real diagram** of the 7
  CBC core competencies (simple, on-brand) and a real assessment-grid screenshot.
  Download-guide CTA if the asset exists.

### F6. M-Pesa Setup (`/mpesa-setup`)
- Step-by-step **numbered guide** (Paybill/Till → ShuleHQ reconciliation) with a
  real receipt/settings screenshot per step. Clean numbered timeline, hairline
  cards. CTA to contact.

### F7. Blog index (`/blog`) + Article (`/blog/[id]`)
- Index: featured post + clean article-card grid (thumbnail, category, title,
  date, read-time) — editorial, generous. Subscribe block (existing form),
  restrained.
- Article: single-column measure (≈680px), strong type scale, real cover image,
  author/date, related posts. This is where craft shows most.

### F8. Changelog (`/changelog`)
- Vertical **timeline**: date → version → grouped changes (Added/Improved/Fixed
  with small semantic dots). Quiet, scannable, no cards-in-cards.

### F9. Careers (`/careers`)
- Short intro + open-roles list (title, team, location, type) as hairline rows →
  role detail. "Why work here" as plain values. If no roles, an honest
  "no openings, reach out" state.

### F10. Help / Support (`/help`)
- Search field (real), category cards (guides, billing, onboarding), top articles
  list, contact fallback. Utility-first, calm.

### F11. Contact / Get started (`/contact`)
- Two-column: left = form (name, school, role, students, curriculum, phone,
  email, goal) with clean inputs (12px radius, hairline, single focus ring);
  right = "How it works" 3-step (Submit → We call back → **Go live**) + one
  genuine quote + direct WhatsApp/call. Success state inline. (Already close —
  just apply the system: reduce radius/shadow, calmer inputs.)

### F12. Privacy (`/privacy`) & Terms (`/terms`)
- Shared **legal template**: slim hero, sticky section index, long-form body at a
  readable measure, last-updated date. No decorative flourishes.

## G. Responsive, states, accessibility
- Breakpoints: mobile ≤640, tablet 641–1024, desktop ≥1025. Design mobile + desktop
  artboards per screen; state tablet reflow rules.
- Every interactive element: default/hover/focus-visible/active/disabled. Visible
  focus ring (2px, accent). Forms: label + help + error states.
- WCAG AA contrast; 44px min tap targets; logical heading order; alt text for all
  imagery; motion honors reduced-motion.

## H. Figma file structure (deliverables)
- **Pages:** `00 Cover`, `01 Foundations` (color/type/spacing/radius/elevation as
  **Variables**), `02 Components` (the Section D7 library, with variants),
  `03 Marketing — Desktop`, `04 Marketing — Mobile`, `05 Archive`.
- One artboard set per Section F screen (desktop + mobile). Name frames
  `Marketing / <Screen> / <Breakpoint>`.
- Ship color + type + spacing as **Figma Variables** so they export to the code
  tokens below.

## I. Handoff → code mapping (keep names identical)
- Figma variables → CSS custom properties in `frontend/src/app/globals.css`
  (`--color-brand-primary`, `--color-dark-navy`, `--color-page-bg`, …) → Tailwind
  utilities already in use (`bg-page-bg`, `text-dark-navy`, `border-brand-border`).
- Radius/elevation variables → replace the `rounded-[2–3rem]` / `shadow-2xl`
  usages. Components map to `src/components/marketing/*`.
- **Scope note:** this brief covers the **marketing site only**. The tenant app
  and the SaaS/admin console get their own briefs afterward (dashboard patterns:
  data tables, forms, nav shell, empty/loading states).
