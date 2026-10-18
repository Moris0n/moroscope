# CelestialPulse: Multi-Source Horoscope Aggregator & Personal Energy Map

CelestialPulse is a mobile-first Progressive Web App (PWA) that systematically aggregates horoscopes from diverse columns, blogs, and video astrologers, normalizes source timezones to UTC, and synthesizes them against user birth profiles (prioritizing Rising sign, falling back to Sun sign) to generate precision-timed local daily activity schedules and interactive weekly energy level wave charts and heatmap matrices.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Confirmed Product & Architecture Specifications:**
> - **Timezone Normalization Architecture (New)**:
>   - **User Timezone Collection**: Automatically detects local device timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone` while providing intuitive manual override controls in the profile header. Supports dual timezones: *Birth Timezone* (crucial for accurate Ascendant/Rising Sign house cusp calculation) and *Current Operating Timezone* (for live transit timing and daily activity calendar slots).
>   - **Source Timezone Normalization Pipeline**: Every curated or suggested source specifies its native publication timezone (e.g., Eastern US for Susan Miller, UTC/GMT for UK astrologers, AEST for Australian channels). All extracted transits, moon void-of-course periods, and planetary aspects are first normalized to a common UTC standard before being localized to the user's active timezone.
> - **Visual Atmosphere**: Deep celestial dark theme (`#080B14` canvas, `#10172A` surfaces) with luminous nebula accents (starlight gold `#F59E0B`, ethereal violet `#8B5CF6`, cosmic cyan `#06B6D4`, and rose quartz `#F43F5E`).
> - **Energy Level Map Visualization**: Dual-view visualization featuring an interactive multi-parameter spline wave chart (tracking 6 cosmic dimensions across the week) alongside an hourly/daily transit heatmap matrix.
> - **Activity Scope**: Comprehensive activity suite spanning Career & Projects, Social & Romance, Hobbies & Creativity, Financial Decisions & Cautions, Physical Wellness, Mind & Spirit, Strategic Decisions, and Rest Windows.
> - **Sign Priority Logic**: Rising sign (Ascendant) dictates the houses, transit impacts, and activity timings; if the user's birth time is unknown, the engine seamlessly falls back to the Sun sign with transparent UI notation.

---

## 1. Overview & Core Concept

- **What It Does**: CelestialPulse aggregates daily and weekly horoscopes from verified publications (newspaper columns, esoteric blogs, and astrologer video transcripts), extracts recurring planetary themes and house transits, standardizes multi-source timelines into UTC, and maps them directly onto the user's personal day in their local timezone. It computes 6 distinct energy dimensions (Mental Focus, Creative Spark, Social Vitality, Physical Drive, Emotional Resonance, and Financial Caution) and schedules optimal windows for projects, socializing, workouts, and high-risk financial decisions.
- **Target Audience / Persona**: Astrologically curious and conscious individuals who want actionable, reliable timing—grounded in real astronomical transits and cross-source consensus rather than generic, untimed one-paragraph horoscopes.
- **Key Value**: Solves the critical problem of timezone discrepancies in astrological forecasts (e.g., a "Tuesday morning transit" published in London occurring on Monday night in California). Unifies, normalizes, and localizes diverse astrological insights into an intuitive, interactive biorhythm and schedule.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Onboarding & Astrological Profiling**:
   - Quick entry of Name, Date of Birth, Birth Time, Birth Location (City/Country), and Birth Timezone.
   - Auto-detection of user's current operating timezone (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`) with instant preview of timezone offset.
   - Real-time calculation of Sun, Moon, and Rising (Ascendant) signs. If birth time is unknown, a simple "Time Unknown" toggle activates the Sun-sign primary mode.
   - Selection of personal priority categories (Career, Finance, Social, Creativity, Wellness, Rest).

2. **Daily Personal Dashboard**:
   - **Current Cosmic Pulse**: Today's composite energy score, primary planetary transit highlights (e.g., *Moon sextile Mercury*, *Mars entering 10th House*), active timezone badge (e.g., `EDT · UTC-4`), and dominant sign focus (Rising sign badge).
   - **Personalized Activity Schedule**: Timed blocks localized to the user's minute, indicating peak windows for *New Project Launches*, *Socializing vs. Deep Hobbies*, *Optimal Rest*, and highlighted *Financial Caution Windows* (e.g., void-of-course moon alerts) with clear start and end times in local time.
   - **Source Breakdown Drawer**: Drill-down view showing which specific sources contributed to today's reading with source-specific publication timezones and conversion history.

3. **Energy Level Map (Weekly Wave Chart & Heatmap Matrix)**:
   - **Interactive Wave Chart**: Canvas/SVG spline wave representing the 7-day trajectory of 6 parameters (Mental, Physical, Emotional, Creative, Social, Financial Risk) calibrated to the user's local day-night cycles.
   - **Transit Heatmap Matrix**: 7-day $\times$ 24-hour visual matrix color-coded by vitality and friction in the user's local hours (00:00 to 23:00), allowing users to pinpoint optimal work and rest blocks.

4. **Source Management & Community Submissions**:
   - Directory of active crawled sources with category tags and declared publication timezones.
   - Toggle sources on/off to customize personal report synthesis and adjust source weights (1x, 1.5x, 2x).
   - "Suggest a Source" modal enabling users to submit new URLs, RSS feeds, or YouTube channel links with category tagging, language, and primary timezone.

5. **PWA & Offline Experience**:
   - In-app install banner with frictionless one-tap install for desktop/Android and guided step-by-step instructions for iOS Safari.
   - Full offline caching using local astronomical algorithms and precached ephemeris tables so users can access their dashboard, energy maps, and localized transit calculations without internet.

### Visual Identity & Theme

- **Aesthetic Direction**: Deep Celestial Editorial. Elegant, atmospheric dark mode evoking a starlit night sky with luminous nebula gradients, crisp typography, and disciplined hairline borders.
- **Color Palette & Mood**:
  - *Dominant Canvas (60%)*: Deep Void Slate (`#080B14`, `#0D111F`)
  - *Structural Surfaces (30%)*: Obsidian Cards (`#131B2E`) with subtle borders (`rgba(255, 255, 255, 0.08)`) and starlight separators
  - *Luminous Nebula Accents (10%)*:
    - Stellar Amber / Sun Gold (`#F59E0B` / `#FBBF24`) - Vitality & Career
    - Astral Violet / Mystic Purple (`#8B5CF6` / `#A78BFA`) - Intuition, Moon & Ascendant
    - Nebula Rose / Crimson (`#F43F5E`) - Financial Cautions & Friction Alerts
    - Cosmic Cyan (`#06B6D4`) - Mental Focus & Communication
    - Emerald Aurora (`#10B981`) - Physical Wellness & Harmony
- **Typography & Hierarchy**:
  - *Display / Headers*: `Outfit` / `Plus Jakarta Sans` with tracking-wide styling and celestial glyph accents.
  - *Body Prose*: `DM Sans` (15px/16px, line-height 1.6) for effortless readability.
  - *Data & Energy Metrics*: `JetBrains Mono` / tabular numerals (`tabular-nums`) for exact timestamps, planetary degrees, and energy indexes.
- **Zero-Pill Discipline**: Metadata (signs, houses, sources, dates, timezones) rendered as clean unboxed text separated by subtle middots (`·`) or slashes. No garish badge clusters.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Universal UTC Normalization Pipeline with Local Projection**
  - *Chosen Approach*: When aggregating horoscopes from diverse publications (e.g., New York, London, Tokyo, Sydney), the system records the source's native timezone and converts all transit events, aspects, and activity suggestions into standard UTC. Upon rendering on the user's dashboard, the calendar engine projects these UTC timestamps into the user's detected or chosen local timezone.
  - *Why*: Eliminates confusing date shifts and off-by-one errors where a user in Los Angeles reads an Australian astrologer's forecast for tomorrow morning without realizing the planetary transit is peaking tonight.
- **Decision 2: Dual-Timezone User Profile (Birth vs. Operating)**
  - *Chosen Approach*: The profile explicitly tracks both `birthTimezone` (used for calculating the exact Rising sign and house cusps based on natal planetary positions) and `operatingTimezone` (used for today's daily activity calendar and local 24-hour wave/heatmap).
  - *Why*: Ensures astronomical accuracy for natal charts even if the user has relocated across the globe.
- **Decision 3: Rising Sign Priority Engine with Sun Sign Fallback**
  - *Chosen Approach*: If birth time is provided, the Ascendant (Rising sign) establishes the 12-house framework and transit timings. If birth time is unavailable, the user's Sun sign serves as the chart ruler (Solar House system).
  - *Why*: Delivers astrologically sound personal horoscopes while maintaining zero-barrier onboarding for users who don't know their exact birth minute.
- **Decision 4: Dual Synthesis (Serverless Ephemeris + Gemini Multi-Source Extractor)**
  - *Chosen Approach*: Core planetary positions, aspects, lunar phases, and baseline energy curves are calculated client-side via a deterministic astronomical transit engine (ensuring 100% offline capability and zero latency). When connected, an Express server endpoint powered by Gemini (`gemini-3.8-flash`) synthesizes text from diverse active horoscope columns and categorizes activities into actionable time blocks.
  - *Why*: Guarantees instant load times and offline PWA compliance while providing rich, nuanced editorial insights from multiple real-world horoscope perspectives.
- **Decision 5: Client-authoritative Persistence with LocalStorage & PWA Service Worker**
  - *Chosen Approach*: User profile, custom source selections, suggested sources, and activity preferences are saved locally in structured storage, combined with `vite-plugin-pwa` for standalone home-screen installation and offline asset caching.
  - *Why*: Maximizes privacy (user birth data remains on their device), eliminates server database dependencies, and fulfills the "serverless if possible" requirement.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                          BROWSER / PWA CLIENT                          │
│                                                                        │
│  ┌───────────────────┐  ┌────────────────────┐  ┌───────────────────┐  │
│  │  Top Nav Bar      │  │  Active Profile    │  │ PWA Install /     │  │
│  │  · Date Selector  │  │  · Rising / Sun    │  │ Offline Status    │  │
│  │  · Sign Glyphs    │  │  · Timezone Pill   │  │ Indicator          │  │
│  └─────────┬─────────┘  └──────────┬─────────┘  └─────────┬─────────┘  │
│            │                       │                      │            │
│  ┌─────────▼───────────────────────▼──────────────────────▼──────────┐ │
│  │                        VIEWPORT VIEWS                             │ │
│  │                                                                   │ │
│  │  [ Dashboard View ]   [ Energy Map View ]   [ Sources View ]      │ │
│  │  - Localized Schedule - 6-Parameter Wave    - Active Feeds & TZs  │ │
│  │  - Transit summary    - Weekly Heatmap      - Source Weights      │ │
│  │  - Financial Cautions - Transit Inspector   - "Suggest Source"    │ │
│  └─────────────────────────────────┬─────────────────────────────────┘ │
│                                    │                                   │
│  ┌─────────────────────────────────▼─────────────────────────────────┐ │
│  │             LOCAL ASTRONOMY & TIMEZONE ENGINE                     │ │
│  │  - UTC Normalization & Local Timezone Projection Pipeline         │ │
│  │  - Ephemeris & Transit Math (Sun, Moon, Planets, Aspects)         │ │
│  │  - Rising Sign / House Cusp Calculator                            │ │
│  │  - Energy Parameter Vector Evaluator (6 dimensions)               │ │
│  │  - LocalStorage State Manager (profile, sources, suggestions)     │ │
│  └─────────────────────────────────┬─────────────────────────────────┘ │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │ (When online: /api/horoscope/synthesize)
┌────────────────────────────────────▼───────────────────────────────────┐
│                    NODE.JS / EXPRESS SERVER PROXY                      │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  /api/horoscope/synthesize (POST)                                │  │
│  │  - Ingests active source texts with declared source timezones    │  │
│  │  - Normalizes transit timings to UTC timestamps                  │  │
│  │  - Calls Gemini API (`gemini-3.8-flash`) with structured schema  │  │
│  │  - Extracts categorized activities, sentiment, & caution windows  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State Entities

- **UserProfile**:
  - `name`: string
  - `birthDate`: string (`YYYY-MM-DD`)
  - `birthTime`?: string (`HH:mm`)
  - `birthLocation`: string
  - `birthTimezone`: string (e.g. `'America/Chicago'`)
  - `operatingTimezone`: string (e.g. `'Europe/London'`)
  - `sunSign`: ZodiacSign
  - `moonSign`: ZodiacSign
  - `risingSign`?: ZodiacSign
  - `hasExactTime`: boolean
  - `activeCategories`: ActivityCategory[] (`career`, `finance`, `social`, `hobbies`, `wellness`, `rest`, `strategic`)
- **HoroscopeSource**:
  - `id`: string
  - `name`: string
  - `type`: `'newspaper' | 'blog' | 'video' | 'column'`
  - `author`: string
  - `sourceTimezone`: string (e.g. `'America/New_York'`)
  - `url`: string
  - `weight`: number (0.5 to 2.0)
  - `isActive`: boolean
  - `sampleExtract`: string
  - `lastCrawled`: string (ISO-8601 UTC)
- **ScheduledActivity**:
  - `id`: string
  - `category`: ActivityCategory
  - `title`: string
  - `description`: string
  - `utcStartTime`: string (ISO-8601)
  - `utcEndTime`: string (ISO-8601)
  - `localTimeWindow`: string (formatted for user's operating timezone, e.g. "14:00 - 16:30 EDT")
  - `significance`: `'favorable' | 'neutral' | 'caution'`
  - `cosmicReason`: string
  - `energyType`: 'mental' | 'physical' | 'emotional' | 'creative' | 'social' | 'financialRisk'
- **EnergyMapData**: 7 days of 24-hour timestamps, each containing scores (0-100) for all 6 dimensions aligned to the user's local operating hours.
- **SourceSuggestion**: `id`, `title`, `url`, `type`, `sourceTimezone`, `description`, `submittedAt`, `status`.

### Interactive Component & State Mapping

- **Timezone Selector & Indicator**: Prominently mounted in the header, showing the user's active timezone with a 1-click modal to switch between Auto-Detected device time and manual custom timezones, with instant re-projection of the entire activity schedule.
- **Profile Bar & Sign Toggle**: Allows switching between Rising-Sign-First mode and Sun-Sign mode with instant recalculation of all activity recommendations and house alignments.
- **Wave Chart Filter Controls**: Buttons for toggling individual energy parameters on/off, adjusting smoothing curves, and hovering to highlight exact transit influences in local time.
- **Activity Scheduler List**: Filterable by category tabs (All, Projects & Career, Social & Hobbies, Financial Cautions, Wellness & Rest). Each item includes local timing, transit rationale, and actionable guidance.
- **Source Configurator Modal & Suggestion Form**: Allows enabling/disabling sources, fine-tuning their influence on the aggregated energy score, viewing each source's native timezone, and submitting new sources with immediate local feedback.
- **PWA Service Worker & Install Component**: Captures `beforeinstallprompt`, renders the in-app install button on Android/Chrome/Desktop, provides custom iOS Safari step-by-step instructions, and triggers an offline banner when network drops.

---
