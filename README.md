# Shaman
Prediction market sentiment analysis. Tracks correlation between real-time sentiment and Polymarket prices using Canonical Correlation Analysis.

## Setup

```bash
npm install
cp .env.example .env
# Add your Gemini API key to .env
npm run dev
```

## Environment Variables

```
VITE_GEMINI_API_KEY=your_gemini_api_key
```

## How it works

1. Scrapes Polymarket API for prediction markets
2. Uses Gemini to generate GDELT sentiment queries  
3. Fetches sentiment data from GDELT API
4. Calculates correlation between sentiment and market prices
5. Shows visual correlation analysis and alerts for divergences

## Tech Stack

- React 19 + TypeScript
- Tailwind CSS + ShadCN UI
- Recharts for visualization
- Fuse.js for fuzzy search
- Polymarket API + GDELT API + Gemini API

## Features

- Search prediction markets with fuzzy matching
- Real-time price and sentiment correlation tracking
- Watchlist for monitoring favorite markets
- Interactive charts showing sentiment vs price movements
- Alerts for significant sentiment-price divergences

Built for identifying market movements before they happen by tracking sentiment shifts.