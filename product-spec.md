# Bloomberg Terminal for Prediction Markets - Product Specification

## Overview
A React-based dashboard that integrates Polymarket prediction market data with GDELT sentiment analysis to provide correlation insights between market movements and news sentiment.

## Core Functionality

### 1. Event Selection & Market Data
- When user clicks on a Polymarket event, fetch the top 5 markets under that event
- Extract market questions for sentiment analysis
- Display market price history with configurable time intervals (1m, 1h, 6h, 1d, 1w)

### 2. Sentiment Analysis Pipeline
- **Natural Language Processing**: Use Gemini API to convert market questions into 5 GDELT API queries
- **Data Fetching**: Query GDELT API for historical sentiment time series data
- **Correlation Analysis**: Use Canonical Correlation Analysis (CCA) to compare market price movements with sentiment data

### 3. Sentiment Sidebar Components
- **Display**: Show up to 25 sentiment analysis components per event
- **Content**: Each component displays:
  - Keywords used in GDELT query
  - Associated market question
  - Correlation strength percentage (0-100%)
  - Color coding: Red (low) → Orange (medium) → Green (high) correlation
- **Sorting**: Components sorted by highest correlation percentage
- **Link Sentiment**: Button to save market-query pairs (only enabled when event is in watchlist)

### 4. Watchlist Integration
- Track events added to watchlist
- Store linked sentiment pairs for each watchlist event
- Enable/disable "Link Sentiment" functionality based on watchlist status

## Technical Architecture

### Data Flow
1. **Event Click** → Fetch top 5 markets → Extract questions
2. **Question Processing** → Gemini API → Generate 5 GDELT queries
3. **Data Collection** → GDELT API → Fetch sentiment time series
4. **Correlation Analysis** → CCA algorithm → Calculate correlation percentages
5. **UI Rendering** → Sidebar components → Display results with color coding

### API Integration
- **Polymarket**: `/api` proxy → `https://gamma-api.polymarket.com`
- **GDELT**: `/gdelt` proxy → `https://api.gdeltproject.org`
- **Gemini**: Direct API calls using `VITE_GEMINI_API_KEY`

### Key Components
- **App.tsx**: Main dashboard with event selection and market display
- **gemini-query.tsx**: Natural language to GDELT query conversion
- **analysis.tsx**: CCA correlation analysis
- **cca.tsx**: Canonical Correlation Analysis implementation
- **SentimentSidebar**: New component for sentiment display

## UI/UX Requirements

### Design Language
- Use existing ShadCN UI components and Tailwind CSS
- Maintain consistent styling with current dashboard
- Dark theme with white/transparent elements

### Sidebar Layout
- Right sidebar (320px width) for sentiment analysis
- Scrollable content area
- Search functionality for sentiment queries
- Color-coded correlation indicators

### Interaction Patterns
- Hover tooltips for disabled "Link Sentiment" buttons
- Loading states during data fetching
- Error handling with user feedback

## Data Structures

### Market-Query Pair
```typescript
interface MarketQueryPair {
  marketId: string;
  marketQuestion: string;
  gdeltQuery: string;
  correlation: number;
  keywords: string[];
  isLinked: boolean;
}
```

### Sentiment Analysis Result
```typescript
interface SentimentResult {
  marketId: string;
  marketQuestion: string;
  gdeltQueries: Array<{
    query: string;
    data: GDELTTimelineEntry[];
    correlation: number;
  }>;
}
```

## Performance Considerations
- Async data fetching to prevent UI blocking
- Debounced user interactions
- Caching of sentiment analysis results
- Maximum 25 components per event to maintain performance

## Error Handling
- API failure recovery
- Data validation and sanitization
- User-friendly error messages
- Graceful degradation when services are unavailable

## Future Enhancements
- Real-time sentiment updates
- Historical correlation trends
- Export functionality for analysis results
- Advanced filtering and search capabilities
