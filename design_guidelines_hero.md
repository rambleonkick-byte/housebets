# ApexOdds Hero & Live Scores Ticker Design Guidelines

## 1. Aesthetic & Identity
- **Concept**: Stadium Night Lights — High-octane arena photography under intense floodlights with deep dark gradients (`#090A0F`), razor-sharp cards (`#12141C`), subtle 1px border grid outlines (`#2A2F45`), and vivid electric neon green (`#10B981`) accents.
- **Typography**: Display headlines in `Outfit` (`font-display`), body/labels in `Inter` (`font-sans`), numbers/odds in `JetBrains Mono` (`font-mono`).

## 2. Hero Carousel Component Specs (~670px desktop center column width)
- **Auto-Rotation**: 5-second interval per slide with linear progress fill indicators.
- **Background Motion**: Ken Burns subtle zoom (`scale-105` over 5s) on background stadium photography.
- **5 Featured Sports Slides**:
  1. **Welcome / VIP Promo**: Headline "BET SMARTER WITH REAL-TIME CRYPTO", subtitle, and primary CTA button.
  2. **NFL Featured Match**: Chiefs vs 49ers (LIVE 3RD QTR, score 24-21) with 3 tap-to-bet odds buttons.
  3. **NBA Featured Match**: Celtics vs Lakers (LIVE 4TH QTR, score 108-105) with spread & total odds buttons.
  4. **UFC Main Event**: Jones vs Miocic (Heavyweight Title) with moneyline & KO odds buttons.
  5. **Premier League Soccer**: Arsenal vs Man City with 1X2 odds buttons.

## 3. Live Scores Ticker Strip Specs
- **Placement**: Directly beneath the Hero Carousel.
- **Style**: Dark marquee band (`bg-[#0B0D14] border-y border-[#2A2F45]`) featuring continuous scrolling cards.
- **Items**: Pulsing `LIVE` badges, team abbreviations, live scores, remaining match time, and instant odds. Pauses scroll on hover.

## 4. Key Image URLs (Stadium Night Lights)
- Welcome/Soccer Arena: `https://images.unsplash.com/photo-1679391029864-d46f366a456b?crop=entropy&cs=srgb&fm=jpg&w=1600&q=80`
- NFL Stadium Night: `https://images.unsplash.com/photo-1566577739112-5180d4bf9390?crop=entropy&cs=srgb&fm=jpg&w=1600&q=80`
- NBA Arena Spotlight: `https://images.unsplash.com/photo-1546519638-68e109498ffc?crop=entropy&cs=srgb&fm=jpg&w=1600&q=80`
- UFC Octagon Night: `https://images.unsplash.com/photo-1517649763962-0c623266010b?crop=entropy&cs=srgb&fm=jpg&w=1600&q=80`
- Premier League Pitch: `https://images.unsplash.com/photo-1508098682722-e99c43a406b2?crop=entropy&cs=srgb&fm=jpg&w=1600&q=80`

## 5. Testing Attributes (`data-testid`)
- Carousel container: `data-testid="hero-carousel"`
- Controls: `data-testid="hero-carousel-prev"`, `data-testid="hero-carousel-next"`
- Live Ticker: `data-testid="live-scores-ticker"`
