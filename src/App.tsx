import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Fuse from "fuse.js";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { X, Plus, TrendingUp, DollarSign, Search, Link as LinkIcon, HelpCircle, Unlink } from 'lucide-react';
import { Skeleton } from './components/ui/skeleton';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Interfaces for sentiment analysis
interface GDELTTimelineEntry {
  datetime: string;
  value: number;
  norm?: number;
  date: string;
}

interface SentimentResult {
  marketId: string;
  marketQuestion: string;
  gdeltQuery: string;
  correlation: number;
  keywords: string[];
  isLinked: boolean;
}

interface MarketQueryPair {
  marketId: string;
  marketQuestion: string;
  gdeltQuery: string;
  correlation: number;
  keywords: string[];
  isLinked: boolean;
}

interface SentimentProgress {
  phase: 'idle' | 'generating' | 'fetching' | 'scoring' | 'finalizing';
  completedMarkets: number;
  totalMarkets: number;
  completedQueries: number;
  totalQueries: number;
}

function App() {
  const [data, setData] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingEvents, setLoadingEvents] = useState<boolean>(true);
  const [loadedEventsCount, setLoadedEventsCount] = useState<number>(0);
  
  // Modified state for top 5 time series
  const [allTimeSeries, setAllTimeSeries] = useState<any[]>([]);
  const [loadingPrices, setLoadingPrices] = useState<boolean>(false);
  const [selectedEventTitle, setSelectedEventTitle] = useState<string | null>(null);
  const [currentEvent, setCurrentEvent] = useState<any>(null);
  
  // New state for interval selection
  const [selectedInterval, setSelectedInterval] = useState('1m');
  const [currentMarkets, setCurrentMarkets] = useState<any[]>([]);

  // Watchlist state
  const [watchlist, setWatchlist] = useState<any[]>([]);
  
  // Sentiment analysis state
  const [sentimentResults, setSentimentResults] = useState<SentimentResult[]>([]);
  const [loadingSentiment, setLoadingSentiment] = useState<boolean>(false);
  const [sentimentProgress, setSentimentProgress] = useState<SentimentProgress>({
    phase: 'idle',
    completedMarkets: 0,
    totalMarkets: 0,
    completedQueries: 0,
    totalQueries: 0
  });
  const [linkedPairs, setLinkedPairs] = useState<Map<string, MarketQueryPair[]>>(new Map());
  
  // Cache for price history data - key: "marketId_interval_fidelity", value: { data, timestamp }
  const priceHistoryCacheRef = useRef<Map<string, { data: any, timestamp: number }>>(new Map());
  const sentimentCacheRef = useRef<Map<string, SentimentResult[]>>(new Map());
  const queryGenerationCacheRef = useRef<Map<string, string[]>>(new Map());
  const gdeltCacheRef = useRef<Map<string, GDELTTimelineEntry[]>>(new Map());
  
  // Cache for noisy data visualizations - key: "eventId_marketKey_query", value: { data: noisyData, color: string }
  const noisyDataCacheRef = useRef<Map<string, { data: any[], color: string }>>(new Map());
  
  // Sentiment search state
  const [sentimentSearchTerm, setSentimentSearchTerm] = useState<string>('');
  const [filteredSentimentResults, setFilteredSentimentResults] = useState<SentimentResult[]>([]);
  
  // Left sidebar is now always open (persistent)

  // Interval configurations
  const intervalConfigs = {
    '1m': { interval: '1m', fidelity: '180' },
    '1h': { interval: '1h', fidelity: '1' },
    '6h': { interval: '6h', fidelity: '1' },
    '1d': { interval: '1d', fidelity: '5' },
    '1w': { interval: '1w', fidelity: '60' }
  };

  useEffect(() => {
    let isCancelled = false;
    const CACHE_KEY = 'shaman_main_events_v1';
    const MAX_CACHE_AGE_MS = 5 * 60 * 1000;

    const fetchAll = async () => {
      setLoadingEvents(true);
      setLoadedEventsCount(0);

      try {
        const cachedRaw = sessionStorage.getItem(CACHE_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) as { timestamp: number; data: any[] };
          if (cached?.data?.length && Date.now() - cached.timestamp < MAX_CACHE_AGE_MS) {
            if (!isCancelled) {
              setData(cached.data);
              setLoadedEventsCount(cached.data.length);
              setLoadingEvents(false);
            }
            return;
          }
        }

        const limit = 500;
        let offset = 0;
        let allData: any[] = [];

        while (true) {
          const response = await fetch(`/api/events?closed=false&limit=${limit}&offset=${offset}`);
          if (!response.ok) {
            throw new Error(`Failed to load events: ${response.status}`);
          }

          const batch = await response.json();
          if (!Array.isArray(batch) || batch.length === 0) break;
          allData = allData.concat(batch);

          if (!isCancelled) {
            setData([...allData]);
            setLoadedEventsCount(allData.length);
          }

          if (batch.length < limit) break;
          offset += limit;
        }

        try {
          sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ timestamp: Date.now(), data: allData })
          );
        } catch (storageError) {
          // Ignore storage quota issues and continue with in-memory data.
          console.warn('Event cache write skipped:', storageError);
        }
      } catch (error) {
        console.error('Failed to load events:', error);
      } finally {
        if (!isCancelled) {
          setLoadingEvents(false);
        }
      }
    };

    fetchAll().catch((err) => {
      if (!isCancelled) {
        setLoadingEvents(false);
        console.error('Failed to load events:', err);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  // Memoize Fuse instance to avoid recreating it on every render
  const fuse = useMemo(() => {
    const options = {
      includeScore: true,
      includeMatches: true,
      threshold: 0.3, // Slightly relaxed for better results
      keys: ["title"],
      limit: 50, // Limit results for better performance
    };
    return new Fuse(data, options);
  }, [data]);

  // Memoize Fuse instance for sentiment search
  const sentimentFuse = useMemo(() => {
    const options = {
      includeScore: true,
      includeMatches: true,
      threshold: 0.4, // Slightly stricter for better relevance
      keys: [
        "marketQuestion",
        "gdeltQuery", 
        "keywords"
      ],
      limit: 25, // Limit results for better performance
    };
    return new Fuse(sentimentResults, options);
  }, [sentimentResults]);

  const searchResults = useMemo(() => {
    const trimmed = searchTerm.trim();
    if (trimmed.length === 0 || data.length === 0) return [];
    const results = fuse.search(trimmed);
    return results.map((result) => result.item).slice(0, 10);
  }, [searchTerm, fuse]);

  // Optimized search handler
  const handleSearch = useCallback((event: { target: { value: string; }; }) => {
    const { value } = event.target;
    setSearchTerm(value);
  }, []);

  // Sentiment search handler
  const handleSentimentSearch = useCallback((event: { target: { value: string; }; }) => {
    const { value } = event.target;
    setSentimentSearchTerm(value);
    
    if (value.length === 0) {
      setFilteredSentimentResults(sentimentResults);
    } else {
      const searchResults = sentimentFuse.search(value);
      // Sort by correlation percentage (highest first) after text matching
      const sortedResults = searchResults
        .map(result => result.item)
        .sort((a, b) => b.correlation - a.correlation);
      setFilteredSentimentResults(sortedResults);
    }
  }, [sentimentResults, sentimentFuse]);

  // Update filtered results when sentiment results change
  useEffect(() => {
    setFilteredSentimentResults(sentimentResults);
  }, [sentimentResults]);

  // Modified price history fetching to accept interval and fidelity parameters with caching
  const fetchPriceHistory = useCallback(async (clobID: string, interval = '1m', fidelity='180') => {
    // Create cache key
    const cacheKey = `${clobID}_${interval}_${fidelity}`;
    const now = Date.now();
    
    // Check if data exists in cache and is still fresh (cache for 5 minutes)
    const cacheExpiry = 5 * 60 * 1000; // 5 minutes in milliseconds
    const cachedData = priceHistoryCacheRef.current.get(cacheKey);
    
    if (cachedData && (now - cachedData.timestamp) < cacheExpiry) {
      console.log(`Using cached data for ${cacheKey}`);
      return cachedData.data;
    }
    
    try {
      console.log(`Fetching fresh data for ${cacheKey}`);
      const response = await fetch(
        `https://clob.polymarket.com/prices-history?market=${clobID}&interval=${interval}&fidelity=${fidelity}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const priceData = await response.json();
      
      priceHistoryCacheRef.current.set(cacheKey, { data: priceData, timestamp: now });
      
      return priceData;
      
    } catch (error) {
      console.error(`Error fetching price history for CLOB ID ${clobID}:`, error);
      return null;
    }
  }, []);

  // Modified to create dataset for top 5 series or single market with two CLOB IDs
  const createOptimizedDataset = useCallback((allSeries: any[], isSingleMarket: boolean = false) => {
    if (allSeries.length === 0) return [];

    // Get the series with the most data points to use as timestamp reference
    const referenceSeries = allSeries.reduce((maxSeries, currentSeries) => {
      if (!maxSeries) return currentSeries;
      return currentSeries.history.length > maxSeries.history.length ? currentSeries : maxSeries;
    });

    if (!referenceSeries || referenceSeries.history.length === 0) return [];

    // Use the reference series timestamps and downsample for performance
    const shouldDownsample = selectedInterval === '1w' || selectedInterval === '1d';
    let timestamps = referenceSeries.history
      .map((point: any) => point.t * 1000)
      .sort((a: number, b: number) => a - b);

    // Apply downsampling if needed
    if (shouldDownsample) {
      timestamps = timestamps.filter((_: any, index: number) => index % 2 === 0);
    }

    // Limit data points to prevent memory issues (max 1000 points)
    const maxPoints = 1000;
    if (timestamps.length > maxPoints) {
      const step = Math.ceil(timestamps.length / maxPoints);
      timestamps = timestamps.filter((_: any, index: number) => index % step === 0);
    }

    const chartData = timestamps.map((timestamp: number) => {
      const dataPoint: any = { timestamp };
      
      // Find closest data point for each series
      allSeries.forEach((series, seriesIndex) => {
        if (series.history && series.history.length > 0) {
          const closestPoint = series.history.reduce((closest: any, current: any) => {
            const currentTime = current.t * 1000;
            const closestTime = closest.t * 1000;
            return Math.abs(currentTime - timestamp) < Math.abs(closestTime - timestamp) 
              ? current : closest;
          });
          
          if (isSingleMarket) {
            // For single market, use "Yes" and "No" labels
            dataPoint[seriesIndex === 0 ? 'Yes' : 'No'] = closestPoint.p;
          } else {
            dataPoint[`series${seriesIndex}`] = closestPoint.p;
          }
        }
      });
      
      return dataPoint;
    });

    return chartData;
  }, [selectedInterval]);

  // Modified to use selected interval and fidelity
  const fetchAndGraphMultipleTimeSeries = useCallback(async (markets: any[], interval: string = '1m', fidelity: string = '180') => {
    try {
      setLoadingPrices(true);
      console.log(`Fetching data for interval: ${interval}, fidelity: ${fidelity}`);
      
      // Check if there's only one market (yes/no market)
      const isSingleMarket = markets.length === 1;
      
      if (isSingleMarket) {
        // For single market, fetch both CLOB IDs (Yes and No)
        const market = markets[0];
        const clobIds = parseClobTokenIds(market.clobTokenIds);
        
        if (clobIds.length >= 2) {
          const [yesPriceData, noPriceData] = await Promise.all([
            fetchPriceHistory(clobIds[0], interval, fidelity),
            fetchPriceHistory(clobIds[1], interval, fidelity)
          ]);
          
          const allSeries = [];
          
          if (yesPriceData?.history?.length > 0) {
            allSeries.push({
              question: market.question,
              clobTokenIds: market.clobTokenIds,
              groupItemTitle: "Yes",
              outcomePrices: JSON.parse(market.outcomePrices)[0],
              volumeNum: market.volumeNum,
              history: yesPriceData.history,
              latestPrice: yesPriceData.history[yesPriceData.history.length - 1].p
            });
          }
          
          if (noPriceData?.history?.length > 0) {
            allSeries.push({
              question: market.question,
              clobTokenIds: market.clobTokenIds,
              groupItemTitle: "No",
              outcomePrices: JSON.parse(market.outcomePrices)[1],
              volumeNum: market.volumeNum,
              history: noPriceData.history,
              latestPrice: noPriceData.history[noPriceData.history.length - 1].p
            });
          }
          
          setAllTimeSeries(allSeries);
        }
      } else {
        // Only process top 5 markets for performance
        const top5Markets = markets.slice(0, 5);
        console.log(`Processing only top 5 markets (${top5Markets.length}) out of ${markets.length} total markets`);
        
        const allSeriesPromises = top5Markets.map(async (market) => {
          const clobIds = parseClobTokenIds(market.clobTokenIds);
          const priceData = await fetchPriceHistory(clobIds[0], interval, fidelity);
          
          if (priceData?.history?.length > 0) {
            return {
              question: market.question,
              clobTokenIds: market.clobTokenIds,
              groupItemTitle: market.groupItemTitle,
              outcomePrices: JSON.parse(market.outcomePrices)[0],
              volumeNum: market.volumeNum,
              history: priceData.history,
              latestPrice: priceData.history[priceData.history.length - 1].p
            };
          }
          return null;
        });

        const allSeries = (await Promise.all(allSeriesPromises)).filter(Boolean) as Array<NonNullable<typeof markets[0]>>;
        
        // Sort by latest price (already limited to top 5)
        const sortedSeries = allSeries
          .filter((series): series is typeof allSeries[0] & { latestPrice: number } => !!series && typeof series.latestPrice === 'number')
          .sort((a, b) => b.latestPrice - a.latestPrice);

        setAllTimeSeries(sortedSeries);
      }
      
    } catch (error) {
      console.error('Error fetching multiple time series:', error);
    } finally {
      setLoadingPrices(false);
    }
  }, [fetchPriceHistory]);

  // New handler for interval changes
  const handleIntervalChange = useCallback((interval: string) => {
    setSelectedInterval(interval);
    if (currentMarkets.length > 0) {
      const config = intervalConfigs[interval as keyof typeof intervalConfigs];
      fetchAndGraphMultipleTimeSeries(currentMarkets, config.interval, config.fidelity);
    }
  }, [currentMarkets, fetchAndGraphMultipleTimeSeries, intervalConfigs]);

  // Watchlist functions
  const addToWatchlist = useCallback((event: any) => {
    if (!watchlist.some(item => item.id === event.id)) {
      setWatchlist(prev => [event, ...prev]); // Add to beginning
    }
  }, [watchlist]);

  const removeFromWatchlist = useCallback((eventId: string) => {
    setWatchlist(prev => prev.filter(item => item.id !== eventId));
  }, []);

  const isInWatchlist = useCallback((eventId: string) => {
    return watchlist.some(item => item.id === eventId);
  }, [watchlist]);

  // Gemini API integration for generating GDELT queries
  const buildFallbackQueries = useCallback((naturalLanguageQuery: string): string[] => {
    const cleaned = naturalLanguageQuery
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) => word.length > 2);

    const uniqueWords = Array.from(new Set(cleaned)).slice(0, 6);
    const w1 = uniqueWords[0] || 'market';
    const w2 = uniqueWords[1] || 'prediction';
    const w3 = uniqueWords[2] || 'odds';
    const w4 = uniqueWords[3] || 'outcome';

    return [
      `"${w1} "`,
      `"${w1} ${w2}"`,
      `(${w1} OR ${w2})`,
      `("${w1} ${w2}" OR ${w3})`,
      `("${w1} ${w2}" OR "${w3} ${w4}")`,
    ];
  }, []);

  const parseQueryArray = useCallback((raw: string): string[] => {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((q) => String(q)).filter(Boolean);
      }
      return [];
    } catch {
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      if (!arrayMatch) return [];
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        return Array.isArray(parsed) ? parsed.map((q) => String(q)).filter(Boolean) : [];
      } catch {
        return [];
      }
    }
  }, []);

  const generateQueries = useCallback(async (naturalLanguageQuery: string): Promise<string[]> => {
    const cachedQueries = queryGenerationCacheRef.current.get(naturalLanguageQuery);
    if (cachedQueries && cachedQueries.length) {
      return cachedQueries;
    }

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      const fallbackQueries = buildFallbackQueries(naturalLanguageQuery);
      queryGenerationCacheRef.current.set(naturalLanguageQuery, fallbackQueries);
      return fallbackQueries;
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-lite",
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1000,
      }
    });
    
    const systemPrompt = `You are a query string generator. Your task is to take any natural language input and convert it into exactly 5 query strings that follow a very strict set of formatting and logical rules.
The purpose of this task is sentiment analysis: the goal of the generated query strings is to maximize the probability that the presence of these queries in sentiment data will track the sentiment implied by the natural language input. Later, these sentiment traces will be compared against prediction market behavior.
Important: Even if a query is not directly related to the input question, if it could plausibly capture related sentiment that might shift prediction markets in a similar way, you must include it.
RULES:
1. Always generate 5 query strings total.
2. Use the exact formatting specified below.
3. Generate queries in 5 groups of 1:
Group 1 (1 queries):
- Single word queries from the input.
- Each must be wrapped in quotes with a space after the word inside the quotes.
- Example: "Zhao ", "Changpeng ", "pardon ", "Donald "
Group 2 (1 queries):
- Two word queries from the input.
- Each must be wrapped in quotes, with a single space between the words.
- Example: "Changpeng pardon", "trump pardon", "Zhao pardon", "trump changpeng"
Group 3 (1 queries):
- Two word queries separated by OR.
- Wrap the entire expression in parentheses.
- Words are not quoted, just plain text.
- Example: (changpeng OR trump), (pardon OR changpeng), (trump OR pardon)
Group 4 (1 queries):
- Three word queries with OR.
- Two words together are quoted, the third is unquoted.
- The whole expression is wrapped in parentheses.
- Example: ("Donald trump" OR pardon), ("Changpeng pardon" OR trump), ("Donald Zhao" OR pardon)
Group 5 (1 queries):
- Four word queries with OR.
- Two words + two words. Each pair wrapped in quotes.
- Entire expression wrapped in parentheses.
- Example: ("Donald trump" OR "changpeng Zhao"), ("trump pardon" OR "Zhao pardon"), ("trump changpeng" OR "pardon Zhao")
OUTPUT FORMAT REQUIREMENT (CRITICAL):
You must always return only a JSON array of 5 strings that match the above rules. No additional comments, explanations, or characters outside of the JSON array are allowed. DO NOT INCLUDE MARKDOWN FENCES, COMMENTS, OR ANYTHING ELSE.`;
    
    const prompt = `${systemPrompt}\n\nInput: ${naturalLanguageQuery}`;
    
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const parsedQueries = parseQueryArray(text);
      const queries = parsedQueries.length >= 5
        ? parsedQueries.slice(0, 5)
        : buildFallbackQueries(naturalLanguageQuery);

      queryGenerationCacheRef.current.set(naturalLanguageQuery, queries);
      return queries;
    } catch (error) {
      console.warn('Falling back to local query generation:', error);
      const fallbackQueries = buildFallbackQueries(naturalLanguageQuery);
      queryGenerationCacheRef.current.set(naturalLanguageQuery, fallbackQueries);
      return fallbackQueries;
    }
  }, [buildFallbackQueries, parseQueryArray]);

  // GDELT API integration - using the exact same class from gemini-query.tsx
  class GDELTMonthlyFetcher {
    private baseUrl = '/gdelt/api/v2/doc/doc';
    private mode: string;

    constructor(mode: string = 'timelinetone') {
      this.mode = mode;
    }


    private buildQuery(baseQuery: string, source?: string, country?: string): string {
      let query = baseQuery;
      if (source) {
        if (source.includes('.')) {
          query += ` domain:${source}`;
        } else {
          query += ` source:${source}`;
        }
      }
      if (country) {
        query += ` sourcecountry:${country}`;
      }
      return query;
    }

    private filterDataByTime(data: GDELTTimelineEntry[], timeLength: string): GDELTTimelineEntry[] {
      if (timeLength === '1m') {
        return data.filter((_, index) => index % 3 === 0);
      } else if (timeLength === '1w') {
        return data.filter((_, index) => index % 2 === 0);
      }
      return data;
    }

    private async fetchSingleTimespan(query: string, timespan: string): Promise<GDELTTimelineEntry[]> {
      const params = new URLSearchParams({
        query: query,
        mode: this.mode,
        format: 'json',
        timespan: timespan
      });

      const url = `${this.baseUrl}?${params.toString()}`;
      
      try {
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const responseText = await response.text();
        
        if (responseText.startsWith('Invalid') || responseText.startsWith('Error') || responseText.startsWith('Un')) {
          console.warn(`API returned error message: ${responseText}`);
          return [];
        }
        
        const data = JSON.parse(responseText);
        const timelineData = data.timeline?.[0]?.data || [];
        
        return timelineData;
      } catch (error) {
        console.error(`Failed to fetch data for timespan ${timespan}:`, error);
        return [];
      }
    }

    async fetchData(query: string, timeLength: string, source?: string, country?: string): Promise<GDELTTimelineEntry[]> {
      const fullQuery = this.buildQuery(query, source, country);
      
      // For 1w, use single request
      const data = await this.fetchSingleTimespan(fullQuery, timeLength);
      const filteredData = this.filterDataByTime(data, timeLength);
      
      return filteredData;
    }
  }

  const fetchGDELTData = useCallback(async (query: string, timeLength: string = '1w'): Promise<GDELTTimelineEntry[]> => {
    const cacheKey = `${query}_${timeLength}`;
    const cachedData = gdeltCacheRef.current.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const fetcher = new GDELTMonthlyFetcher();
    const data = await fetcher.fetchData(query, timeLength, '', '');
    gdeltCacheRef.current.set(cacheKey, data);
    return data;
  }, []);

  const parseGDELTTimestamp = useCallback((raw: string): number => {
    const directParsed = new Date(raw).getTime();
    if (!Number.isNaN(directParsed)) return directParsed;

    const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return Date.now();

    return Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6])
    );
  }, []);

  const parseClobTokenIds = useCallback((raw: unknown): string[] => {
    if (Array.isArray(raw)) {
      return raw.map((id) => String(id)).filter(Boolean);
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((id) => String(id)).filter(Boolean);
        }
      } catch {
        return raw.split(',').map((v) => v.trim()).filter(Boolean);
      }
    }
    return [];
  }, []);

  const calculatePearson = useCallback((x: number[], y: number[]): number => {
    if (x.length !== y.length || x.length < 2) return 0;
    const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
    const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < x.length; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    const denominator = Math.sqrt(denomX * denomY);
    return denominator === 0 ? 0 : numerator / denominator;
  }, []);

  const calculateSpearman = useCallback((x: number[], y: number[]): number => {
    if (x.length !== y.length || x.length < 2) return 0;
    const rank = (values: number[]) => {
      const sorted = values
        .map((value, index) => ({ value, index }))
        .sort((a, b) => a.value - b.value);
      const ranks = new Array(values.length).fill(0);
      for (let i = 0; i < sorted.length; i++) {
        ranks[sorted[i].index] = i + 1;
      }
      return ranks;
    };
    return calculatePearson(rank(x), rank(y));
  }, [calculatePearson]);

  const directionalAgreement = useCallback((x: number[], y: number[]): number => {
    if (x.length !== y.length || x.length === 0) return 0;
    let sameDirectionCount = 0;
    for (let i = 0; i < x.length; i++) {
      if ((x[i] >= 0 && y[i] >= 0) || (x[i] < 0 && y[i] < 0)) {
        sameDirectionCount += 1;
      }
    }
    return sameDirectionCount / x.length;
  }, []);

  const calculatePredictiveScore = useCallback((seriesA: any[], seriesB: any[]): number => {
    if (!seriesA?.length || !seriesB?.length) return 0;

    const valuesA = seriesA
      .map((point) => point?.value)
      .filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value));
    const valuesB = seriesB
      .map((point) => point?.value)
      .filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value));

    const maxWindow = 600;
    const minLength = Math.min(valuesA.length, valuesB.length, maxWindow);
    if (minLength < 20) return 0;

    const sampleA = valuesA.slice(-minLength);
    const sampleB = valuesB.slice(-minLength);
    const maxLag = 12;
    let bestScore = 0;

    for (let lag = -maxLag; lag <= maxLag; lag++) {
      let alignedA = sampleA;
      let alignedB = sampleB;

      if (lag > 0) {
        alignedA = sampleA.slice(lag);
        alignedB = sampleB.slice(0, sampleB.length - lag);
      } else if (lag < 0) {
        const shift = Math.abs(lag);
        alignedA = sampleA.slice(0, sampleA.length - shift);
        alignedB = sampleB.slice(shift);
      }

      if (alignedA.length < 20 || alignedB.length < 20) continue;

      const returnsA = alignedA.slice(1).map((value, index) => value - alignedA[index]);
      const returnsB = alignedB.slice(1).map((value, index) => value - alignedB[index]);
      if (returnsA.length < 10 || returnsB.length < 10) continue;

      const levelPearson = Math.abs(calculatePearson(alignedA, alignedB));
      const returnPearson = Math.abs(calculatePearson(returnsA, returnsB));
      const spearman = Math.abs(calculateSpearman(alignedA, alignedB));
      const direction = directionalAgreement(returnsA, returnsB);

      const weightedScore = (
        returnPearson * 0.45 +
        levelPearson * 0.25 +
        spearman * 0.2 +
        direction * 0.1
      ) * 100;

      if (weightedScore > bestScore) {
        bestScore = weightedScore;
      }
    }

    return Number.isFinite(bestScore) ? Math.max(0, Math.min(100, bestScore)) : 0;
  }, [calculatePearson, calculateSpearman, directionalAgreement]);

  // Optimized sentiment analysis function with caching and parallel processing
  const performSentimentAnalysis = useCallback(async (markets: any[]) => {
    if (!markets || markets.length === 0) return;

    const cacheKey = markets.slice(0, 5).map((m) => m.id || m.question).join('_');
    const eventId = currentEvent?.id || '';

    const cachedResults = sentimentCacheRef.current.get(cacheKey);
    if (cachedResults && cachedResults.length > 0) {
      const sortedCached = [...cachedResults].sort((a, b) => b.correlation - a.correlation).slice(0, 15);
      setSentimentResults(sortedCached);
      setFilteredSentimentResults(sortedCached);
      setSentimentProgress({
        phase: 'idle',
        completedMarkets: 0,
        totalMarkets: 0,
        completedQueries: 0,
        totalQueries: 0
      });
      return;
    }

    setLoadingSentiment(true);
    setSentimentResults([]);
    setFilteredSentimentResults([]);

    const dedupeAndSort = (results: SentimentResult[]) => {
      const byKey = new Map<string, SentimentResult>();
      for (const result of results) {
        const key = `${result.marketId}__${result.gdeltQuery}`;
        const existing = byKey.get(key);
        if (!existing || result.correlation > existing.correlation) {
          byKey.set(key, result);
        }
      }
      return Array.from(byKey.values()).sort((a, b) => b.correlation - a.correlation).slice(0, 15);
    };

    const applyLinkingState = (results: SentimentResult[]) => {
      const linkedPairsForEvent = linkedPairs.get(eventId) || [];
      let withLinks = results.map((result) => ({
        ...result,
        isLinked: linkedPairsForEvent.some(
          (pair) => pair.marketId === result.marketId && pair.gdeltQuery === result.gdeltQuery
        )
      }));

      if (eventId && linkedPairsForEvent.length === 0 && withLinks.length > 0) {
        const top = withLinks[0];
        withLinks = withLinks.map((result) =>
          result.marketId === top.marketId && result.gdeltQuery === top.gdeltQuery
            ? { ...result, isLinked: true }
            : result
        );
      }
      return withLinks;
    };

    const publishResults = (results: SentimentResult[]) => {
      const linked = applyLinkingState(dedupeAndSort(results));
      setSentimentResults(linked);
      setFilteredSentimentResults(linked);
      sentimentCacheRef.current.set(cacheKey, linked);

      if (eventId) {
        const linkedResults = linked.filter((result) => result.isLinked);
        if (linkedResults.length > 0) {
          const restoredPairs = linkedResults.map((result) => ({
            marketId: result.marketId,
            marketQuestion: result.marketQuestion,
            gdeltQuery: result.gdeltQuery,
            correlation: result.correlation,
            keywords: result.keywords,
            isLinked: true
          }));
          setLinkedPairs((prev) => {
            const next = new Map(prev);
            next.set(eventId, restoredPairs);
            return next;
          });
        }
      }
      return linked;
    };

    const runWithConcurrency = async <T,>(
      tasks: Array<() => Promise<T>>,
      limit: number
    ): Promise<T[]> => {
      const results = new Array<T>(tasks.length);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
        while (cursor < tasks.length) {
          const index = cursor++;
          results[index] = await tasks[index]();
        }
      });
      await Promise.all(workers);
      return results;
    };

    const scoreMarketWithQueries = async (
      market: any,
      queries: string[],
      onQueryDone: () => void
    ): Promise<SentimentResult[]> => {
      const clobIds = parseClobTokenIds(market.clobTokenIds);
      if (!clobIds[0]) return [];

      const marketPriceData = await fetchPriceHistory(clobIds[0], '1m', '180');
      if (!marketPriceData?.history?.length) return [];

      const marketSeries = marketPriceData.history.map((point: any) => ({
        timestamp: point.t * 1000,
        value: point.p
      }));

      const tasks = queries.map((query) => async () => {
        let gdeltData = await fetchGDELTData(query, '1week');
        if (gdeltData.length === 0) {
          const broadFallbackQuery = market.question
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 4)
            .join(' OR ');
          if (broadFallbackQuery) {
            gdeltData = await fetchGDELTData(`(${broadFallbackQuery})`, '1week');
          }
        }

        const gdeltSeries = gdeltData.map((point: GDELTTimelineEntry) => ({
          timestamp: parseGDELTTimestamp(point.date),
          value: point.value
        }));

        const correlation = gdeltSeries.length > 0 ? calculatePredictiveScore(marketSeries, gdeltSeries) : 0;
        const result: SentimentResult = {
          marketId: market.id || market.question,
          marketQuestion: market.question,
          gdeltQuery: query,
          correlation,
          keywords: extractKeywordsFromQuery(query),
          isLinked: false
        };
        onQueryDone();
        return result;
      });

      const scored = await runWithConcurrency(tasks, 4);
      return scored.filter(Boolean);
    };

    const topMarkets = markets.slice(0, 5);
    const fastMarkets = topMarkets.slice(0, 3);
    const fastQueriesPerMarket = 2;
    const enrichQueriesPerMarket = 3;
    const fastTotalQueries = fastMarkets.length * fastQueriesPerMarket;

    try {
      setSentimentProgress({
        phase: 'fetching',
        completedMarkets: 0,
        totalMarkets: fastMarkets.length,
        completedQueries: 0,
        totalQueries: fastTotalQueries
      });

      const fastTasks = fastMarkets.map((market) => async () => {
        const fallbackQueries = buildFallbackQueries(market.question).slice(0, fastQueriesPerMarket);
        const results = await scoreMarketWithQueries(market, fallbackQueries, () => {
          setSentimentProgress((prev) => ({
            ...prev,
            phase: 'scoring',
            completedQueries: Math.min(prev.completedQueries + 1, prev.totalQueries)
          }));
        });
        setSentimentProgress((prev) => ({
          ...prev,
          completedMarkets: prev.completedMarkets + 1
        }));
        return results;
      });

      const fastResults = (await runWithConcurrency(fastTasks, 3)).flat();
      if (fastResults.length > 0) {
        publishResults(fastResults);
      }
    } catch (error) {
      console.error('Fast sentiment pass failed:', error);
    } finally {
      setLoadingSentiment(false);
      setSentimentProgress({
        phase: 'idle',
        completedMarkets: 0,
        totalMarkets: 0,
        completedQueries: 0,
        totalQueries: 0
      });
    }

    // Background enrichment with Gemini-generated queries.
    void (async () => {
      try {
        const baseResults = sentimentCacheRef.current.get(cacheKey) || [];
        const enrichTasks = topMarkets.map((market) => async () => {
          let modelQueries: string[] = [];
          try {
            modelQueries = (await generateQueries(market.question)).slice(0, enrichQueriesPerMarket);
          } catch {
            modelQueries = buildFallbackQueries(market.question).slice(0, enrichQueriesPerMarket);
          }

          const existingKeys = new Set(
            baseResults
              .filter((result) => result.marketId === (market.id || market.question))
              .map((result) => result.gdeltQuery)
          );
          const newQueries = modelQueries.filter((query) => !existingKeys.has(query));
          if (newQueries.length === 0) return [];
          return scoreMarketWithQueries(market, newQueries, () => undefined);
        });

        const enriched = (await runWithConcurrency(enrichTasks, 2)).flat();
        if (enriched.length === 0) return;
        publishResults([...baseResults, ...enriched]);
      } catch (error) {
        console.error('Background sentiment enrichment failed:', error);
      }
    })();
  }, [
    generateQueries,
    fetchGDELTData,
    fetchPriceHistory,
    linkedPairs,
    currentEvent,
    calculatePredictiveScore,
    parseGDELTTimestamp,
    parseClobTokenIds,
    buildFallbackQueries
  ]);

  // Helper function to extract keywords from GDELT query
  const extractKeywordsFromQuery = useCallback((query: string): string[] => {
    // Extract words from quotes and OR statements
    const quotedWords = query.match(/"([^"]+)"/g) || [];
    const orWords = query.match(/\(([^)]+)\)/g) || [];
    
    const keywords: string[] = [];
    
    quotedWords.forEach(quoted => {
      const word = quoted.replace(/"/g, '').trim();
      if (word) keywords.push(word);
    });
    
    orWords.forEach(or => {
      const content = or.replace(/[()]/g, '').trim();
      const words = content.split(/\s+OR\s+/i).map(w => w.trim());
      keywords.push(...words);
    });
    
    return keywords.slice(0, 5); // Limit to 5 keywords
  }, []);

  // Noise generation functions
  // Box-Muller transform for Gaussian noise generation
  const generateGaussianNoise = useCallback((): number => {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z0;
  }, []);

  // Generate random color for noisy lines
  const generateRandomColor = useCallback(() => {
    const colors = [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57',
      '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3', '#ff9f43',
      '#ee5a24', '#0984e3', '#6c5ce7', '#a29bfe', '#fd79a8',
      '#fdcb6e', '#e17055', '#00b894', '#e84393', '#2d3436'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }, []);

  // Generate dramatically noisy data based on correlation percentage for a specific market
  const generateNoisyData = useCallback((originalData: any[], correlationPercentage: number, query: string, targetMarketKey: string) => {
    if (!originalData || originalData.length === 0) return [];

    // More reasonable noise scaling based on correlation percentage
    const minNoiseLevel = 0.1; // 10% minimum noise even at 100% correlation
    const maxNoiseLevel = 1.5; // 150% maximum noise at 0% correlation
    
    // Use a more gradual scaling curve - only extreme at very low correlations
    let correlationFactor;
    if (correlationPercentage >= 70) {
      // High correlations: very little noise
      correlationFactor = (1 - correlationPercentage / 100) * 0.3;
    } else if (correlationPercentage >= 40) {
      // Medium correlations: moderate noise
      correlationFactor = (1 - correlationPercentage / 100) * 0.7;
    } else if (correlationPercentage >= 20) {
      // Low correlations: high noise
      correlationFactor = Math.pow(1 - correlationPercentage / 100, 1.5);
    } else {
      // Very low correlations: extreme noise
      correlationFactor = Math.pow(1 - correlationPercentage / 100, 2.5);
    }
    
    const baseNoiseLevel = minNoiseLevel + (maxNoiseLevel - minNoiseLevel) * correlationFactor;
    
    return originalData.map((point, index) => {
      const noisyPoint = { ...point };
      
      // Only add noise to the specific target market key
      if (point[targetMarketKey] !== undefined && typeof point[targetMarketKey] === 'number') {
        const originalValue = point[targetMarketKey];
        
        // Multiple noise sources for more chaotic effect
        const gaussianNoise1 = generateGaussianNoise();
        const gaussianNoise2 = generateGaussianNoise();
        const uniformNoise = (Math.random() * 2 - 1); // -1 to 1
        
        // Time-based noise for more realistic chaotic behavior
        const timeNoise = Math.sin(index * 0.1) * 0.5;
        
        // Calculate different types of noise
        const relativeNoise = gaussianNoise1 * baseNoiseLevel * originalValue;
        const absoluteNoise = gaussianNoise2 * baseNoiseLevel * 0.5; // Absolute noise
        const uniformNoiseComponent = uniformNoise * baseNoiseLevel * 0.3;
        const timeBasedNoise = timeNoise * baseNoiseLevel * 0.2;
        
        // Moderate scaling for very low correlations
        let extremeMultiplier = 1;
        if (correlationPercentage < 20) extremeMultiplier = 1.5;
        if (correlationPercentage < 10) extremeMultiplier = 2.5;
        if (correlationPercentage < 5) extremeMultiplier = 4;
        
        // Combine all noise sources
        const totalNoise = (relativeNoise + absoluteNoise + uniformNoiseComponent + timeBasedNoise) * extremeMultiplier;
        
        // Add some random spikes for very low correlations
        let spikeNoise = 0;
        if (correlationPercentage < 5 && Math.random() < 0.05) {
          spikeNoise = (Math.random() * 2 - 1) * 0.3; // Random spikes (reduced frequency and intensity)
        }
        
        const finalValue = originalValue + totalNoise + spikeNoise;
        noisyPoint[targetMarketKey] = Math.max(0, Math.min(1, finalValue));
      }
      
      // Add query information for labeling
      noisyPoint.query = query;
      noisyPoint.isNoisy = true;
      
      return noisyPoint;
    });
  }, [generateGaussianNoise]);

  // Link sentiment functionality
  const linkSentiment = useCallback((result: SentimentResult) => {
    if (!currentEvent) return;
    
    const eventId = currentEvent.id;
    const newPair: MarketQueryPair = {
      marketId: result.marketId,
      marketQuestion: result.marketQuestion,
      gdeltQuery: result.gdeltQuery,
      correlation: result.correlation,
      keywords: result.keywords,
      isLinked: true
    };
    
    setLinkedPairs(prev => {
      const newMap = new Map(prev);
      const existingPairs = newMap.get(eventId) || [];
      newMap.set(eventId, [...existingPairs, newPair]);
      return newMap;
    });
    
    // Update the result to show it's linked
    setSentimentResults(prev => {
      const updated = prev.map(r => 
        r.marketId === result.marketId && r.gdeltQuery === result.gdeltQuery
          ? { ...r, isLinked: true }
          : r
      );
      // Also update filtered results to ensure UI reflects the change immediately
      setFilteredSentimentResults(updated);
      return updated;
    });
    
    // Update the cache with the new linking state
    const cacheKey = currentMarkets.slice(0, 5).map(m => m.id || m.question).join('_');
    const cachedResults = sentimentCacheRef.current.get(cacheKey);
    if (cachedResults) {
      sentimentCacheRef.current.set(
        cacheKey,
        cachedResults.map(r => 
          r.marketId === result.marketId && r.gdeltQuery === result.gdeltQuery
            ? { ...r, isLinked: true }
            : r
        )
      );
    }
  }, [currentEvent, currentMarkets]);

  // Unlink sentiment functionality
  const unlinkSentiment = useCallback((result: SentimentResult) => {
    if (!currentEvent) return;
    
    const eventId = currentEvent.id;
    
    setLinkedPairs(prev => {
      const newMap = new Map(prev);
      const existingPairs = newMap.get(eventId) || [];
      const filteredPairs = existingPairs.filter(pair => 
        !(pair.marketId === result.marketId && pair.gdeltQuery === result.gdeltQuery)
      );
      newMap.set(eventId, filteredPairs);
      return newMap;
    });
    
    // Update the result to show it's unlinked
    setSentimentResults(prev => {
      const updated = prev.map(r => 
        r.marketId === result.marketId && r.gdeltQuery === result.gdeltQuery
          ? { ...r, isLinked: false }
          : r
      );
      // Also update filtered results to ensure UI reflects the change immediately
      setFilteredSentimentResults(updated);
      return updated;
    });
    
    // Clear noisy data cache for this specific query
    const isSingleMarket = currentMarkets.length === 1;
    let targetMarketKey: string;
    
    if (isSingleMarket) {
      const availableKeys = Object.keys(chartData[0] || {}).filter(key => key !== 'timestamp');
      targetMarketKey = availableKeys[0] || 'Yes';
    } else {
      const marketIndex = currentMarkets.findIndex(market => 
        market.id === result.marketId || market.question === result.marketQuestion
      );
      targetMarketKey = marketIndex >= 0 ? `series${marketIndex}` : 'series0';
    }
    
    const noisyCacheKey = `${eventId}_${targetMarketKey}_${result.gdeltQuery}`;
    noisyDataCacheRef.current.delete(noisyCacheKey);
    
    // Update the cache with the new linking state
    const cacheKey = currentMarkets.slice(0, 5).map(m => m.id || m.question).join('_');
    const cachedResults = sentimentCacheRef.current.get(cacheKey);
    if (cachedResults) {
      sentimentCacheRef.current.set(
        cacheKey,
        cachedResults.map(r => 
          r.marketId === result.marketId && r.gdeltQuery === result.gdeltQuery
            ? { ...r, isLinked: false }
            : r
        )
      );
    }
  }, [currentEvent, currentMarkets]);

  // Memoize chart data to prevent recalculation on every render
  const chartData = useMemo(() => {
    const isSingleMarket = currentMarkets.length === 1;
    const data = createOptimizedDataset(allTimeSeries, isSingleMarket);
    return data;
  }, [allTimeSeries, createOptimizedDataset, currentMarkets.length, selectedInterval]);

  // Generate noisy data for ALL linked sentiments with caching
  const noisyChartData = useMemo(() => {
    if (!currentEvent || !chartData || chartData.length === 0) return [];
    
    const eventId = currentEvent.id;
    const linkedPairsForEvent = linkedPairs.get(eventId) || [];
    
    if (linkedPairsForEvent.length === 0) return [];
    
    // Process ALL linked pairs, not just the first one
    const noisyDataSets = linkedPairsForEvent.map(linkedPair => {
      // Find the sentiment result to get the correlation percentage
      const sentimentResult = sentimentResults.find(r => 
        r.marketId === linkedPair.marketId && r.gdeltQuery === linkedPair.gdeltQuery
      );
      
      if (!sentimentResult) return null;
      
      // Determine the target market key based on the market structure
      const isSingleMarket = currentMarkets.length === 1;
      let targetMarketKey: string;
      
      if (isSingleMarket) {
        // For single market, we need to find which outcome (Yes/No) corresponds to the linked market
        // For now, we'll use the first available key that's not timestamp
        const availableKeys = Object.keys(chartData[0] || {}).filter(key => key !== 'timestamp');
        targetMarketKey = availableKeys[0] || 'Yes'; // Default to 'Yes' if no keys found
      } else {
        // For multiple markets, find the market index that matches the linked market
        const marketIndex = currentMarkets.findIndex(market => 
          market.id === linkedPair.marketId || market.question === linkedPair.marketQuestion
        );
        targetMarketKey = marketIndex >= 0 ? `series${marketIndex}` : 'series0';
      }
      
      // Create cache key
      const cacheKey = `${eventId}_${targetMarketKey}_${linkedPair.gdeltQuery}`;
      
      // Check if we have cached noisy data
      const cachedNoisyData = noisyDataCacheRef.current.get(cacheKey);
      if (cachedNoisyData && cachedNoisyData.data.length > 0) {
        console.log('✅ Using cached noisy data for:', cacheKey);
        return {
          data: cachedNoisyData.data,
          color: cachedNoisyData.color,
          query: linkedPair.gdeltQuery,
          targetMarketKey,
          correlation: sentimentResult.correlation
        };
      }
      
      // Generate random color for this noisy line
      const randomColor = generateRandomColor();
      
      // Generate noisy data based on the correlation percentage for the specific market
      const noisyData = generateNoisyData(chartData, sentimentResult.correlation, linkedPair.gdeltQuery, targetMarketKey);
      
      // Cache the noisy data with its color
      if (noisyData.length > 0) {
        noisyDataCacheRef.current.set(cacheKey, { data: noisyData, color: randomColor });
      }
      
      return {
        data: noisyData,
        color: randomColor,
        query: linkedPair.gdeltQuery,
        targetMarketKey,
        correlation: sentimentResult.correlation
      };
    }).filter(Boolean); // Remove null entries
    
    return noisyDataSets;
  }, [chartData, currentEvent, linkedPairs, sentimentResults, generateNoisyData, currentMarkets, generateRandomColor]);

  // Memoize the entire chart component with responsive tooltip
  const renderTimeSeriesGraph = useMemo(() => {
    if (allTimeSeries.length === 0) return null;

    const isSingleMarket = currentMarkets.length === 1;
    
    // Fey-inspired color palette - more subtle and professional
    const colors = isSingleMarket 
      ? ['#10b981', '#ef4444'] // Green for Yes, Red for No
      : ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
    
    // Noisy data is now an array of datasets, each with its own color

    const customTooltip = ({ active, payload, label }: any) => {
      if (active && payload && payload.length) {
        const date = new Date(label);
        const formattedDate = date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });

        return (
          <div className="bg-black/95 backdrop-blur-sm border border-white/10 p-3 rounded-xl shadow-2xl">
            <p className="text-white font-medium text-sm mb-2">{formattedDate}</p>
            {payload
              .filter((entry: any) => entry.value !== undefined)
              .map((entry: any, index: number) => {
                // Check if this is a noisy line by checking if the color matches any noisy dataset
                const noisyDataset = noisyChartData.find(dataset => dataset && dataset.color === entry.color);
                
                if (noisyDataset) {
                  // Handle noisy line tooltip
                  const probability = (entry.value * 100).toFixed(1);
                  return (
                    <div key={index} className="flex items-center justify-between py-1">
                      <div className="flex items-center space-x-2">
                        <div 
                          className="w-2 h-2 rounded-full" 
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-white/60 text-xs italic truncate max-w-[120px]">
                          Query: {noisyDataset.query.length > 20 
                            ? `${noisyDataset.query.substring(0, 20)}...` 
                            : noisyDataset.query} ({noisyDataset.correlation.toFixed(1)}%)
                        </span>
                      </div>
                      <span className="text-white font-medium text-xs ml-2">
                        {probability}%
                      </span>
                    </div>
                  );
                }
                
                // Handle regular series tooltip
                let series;
                if (isSingleMarket) {
                  // For single market, use the dataKey directly (Yes/No)
                  series = allTimeSeries.find(s => s.groupItemTitle === entry.dataKey);
                } else {
                  const seriesIndex = parseInt(entry.dataKey.replace('series', ''));
                  series = allTimeSeries[seriesIndex];
                }
                
                if (series) {
                  const probability = (entry.value * 100).toFixed(1);
                  return (
                    <div key={index} className="flex items-center justify-between py-1">
                      <div className="flex items-center space-x-2">
                        <div 
                          className="w-2 h-2 rounded-full" 
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-white/90 text-xs truncate max-w-[120px]">
                          {series.groupItemTitle || "Yes"}
                        </span>
                      </div>
                      <span className="text-white font-medium text-xs ml-2">
                        {probability}%
                      </span>
                    </div>
                  );
                }
                return null;
              })}
          </div>
        );
      }
      return null;
    };

    return (
      <div className="w-full mt-8">
        <div className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6 space-y-4 lg:space-y-0">
            <div>
              <h3 className="text-white text-2xl font-semibold  tracking-tight">
                {selectedEventTitle || 'Price History'}
              </h3>
              {loadingPrices && (
                <p className="text-xs text-white/60 mt-1">Loading market price history...</p>
              )}
            </div>
            
            {/* Interval buttons with shadcn styling */}
            <div className="inline-flex h-9 items-center justify-center rounded-lg bg-white/5 p-1 text-white/60 backdrop-blur-sm border border-white/10">
              {['1h', '6h', '1d', '1w', '1m'].map((interval) => (
                <button
                  key={interval}
                  onClick={() => handleIntervalChange(interval)}
                  className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium  ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
                    selectedInterval === interval
                      ? 'bg-white text-black shadow-sm'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {interval}
                </button>
              ))}
            </div>
          </div>
          
          <div className="h-[500px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <defs>
                  <linearGradient id="gridGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.1)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
                  </linearGradient>
                </defs>
                <CartesianGrid 
                  strokeDasharray="1 3" 
                  stroke="rgba(255,255,255,0.06)" 
                  strokeWidth={0.5}
                />
                <XAxis 
                  dataKey="timestamp" 
                  stroke="rgba(255,255,255,0.4)"
                  fontSize={11}
                  fontFamily="Inter"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(timestamp) => {
                    const date = new Date(timestamp);
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  }}
                />
                <YAxis 
                  stroke="rgba(255,255,255,0.4)"
                  fontSize={11}
                  fontFamily="Inter"
                  domain={[0, 1]}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                />
                <Tooltip content={customTooltip} />
                <Legend 
                  formatter={(value, entry) => {
                    // Check if this is a noisy line entry by checking if the color matches any noisy dataset
                    const noisyDataset = noisyChartData.find(dataset => dataset && dataset.color === entry?.color);
                    
                    if (noisyDataset) {
                      return (
                        <span className="text-sm text-white/60 italic">
                          Query: {noisyDataset.query.length > 30 
                            ? `${noisyDataset.query.substring(0, 30)}...` 
                            : noisyDataset.query} ({noisyDataset.correlation.toFixed(1)}%)
                        </span>
                      );
                    }
                    
                    // Regular series legend
                    let series;
                    if (isSingleMarket) {
                      // For single market, use the value directly (Yes/No)
                      series = allTimeSeries.find(s => s.groupItemTitle === value);
                    } else {
                      const seriesIndex = parseInt(value.replace('series', ''));
                      series = allTimeSeries[seriesIndex];
                    }
                    return series ? (
                      <span className="text-sm  text-white/80">
                        {series.groupItemTitle || "Yes"} ({(series.latestPrice * 100).toFixed(1)}%)
                      </span>
                    ) : value;
                  }}
                  wrapperStyle={{ 
                    paddingTop: '24px',
                    fontSize: '12px'
                  }}
                />
                {allTimeSeries.map((_, index) => (
                  <Line
                    key={index}
                    type="monotone"
                    dataKey={isSingleMarket ? allTimeSeries[index].groupItemTitle : `series${index}`}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls={true}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    isAnimationActive={false}
                    filter="drop-shadow(0 0 6px rgba(99, 102, 241, 0.3))"
                  />
                ))}
                
                {/* Add noisy data as dotted lines for ALL linked markets */}
                {noisyChartData.filter(dataset => dataset).map((noisyDataset, index) => {
                  if (!noisyDataset) return null;
                  return (
                    <Line
                      key={`noisy-${index}-${noisyDataset.query}`}
                      type="monotone"
                      dataKey={noisyDataset.targetMarketKey}
                      data={noisyDataset.data}
                      stroke={noisyDataset.color}
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={false}
                      connectNulls={true}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      isAnimationActive={false}
                      opacity={0.8}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          
          {/* Market summary cards with Fey-inspired design */}
          {allTimeSeries.length > 0 && (
            <div className={`mt-6 grid gap-3 ${isSingleMarket ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5'}`}>
              {allTimeSeries.map((series, index) => (
                <div 
                  key={index} 
                  className="group relative bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 rounded-xl p-4 transition-all duration-200 backdrop-blur-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div 
                      className="w-3 h-3 rounded-full shadow-lg"
                      style={{ 
                        backgroundColor: colors[index % colors.length],
                        boxShadow: `0 0 12px ${colors[index % colors.length]}40`
                      }}
                    />
                    <span className="text-white/50 text-xs  font-medium">
                      #{index + 1}
                    </span>
                  </div>
                  <h4 className="text-white font-semibold text-sm  leading-tight mb-3 line-clamp-2 group-hover:text-white/90 transition-colors">
                    {series.groupItemTitle || "Yes"}
                  </h4>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-white/60 text-xs ">Current</span>
                      <span className="text-white font-medium text-sm ">
                        {(series.latestPrice * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/60 text-xs ">Volume</span>
                      <span className="text-white/80 text-xs  font-medium">
                        ${series.volumeNum ? (series.volumeNum > 1000000 ? `${(series.volumeNum/1000000).toFixed(1)}M` : `${(series.volumeNum/1000).toFixed(0)}K`) : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add to Watchlist Button with shadcn styling */}
          {currentEvent && (
            <div className="mt-8 flex justify-center">
              <button
                onClick={() => addToWatchlist(currentEvent)}
                disabled={isInWatchlist(currentEvent.id)}
                className={`inline-flex items-center justify-center rounded-xl text-sm font-medium  ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-11 px-8 ${
                  isInWatchlist(currentEvent.id)
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-not-allowed'
                    : 'bg-white text-black hover:bg-white/90 shadow-lg hover:shadow-xl'
                }`}
              >
                {isInWatchlist(currentEvent.id) ? (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Added to Watchlist
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Add to Watchlist
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }, [allTimeSeries, chartData, noisyChartData, loadingPrices, selectedEventTitle, selectedInterval, handleIntervalChange, currentEvent, addToWatchlist, isInWatchlist, currentMarkets.length, linkedPairs, currentMarkets]);

  // Modified click handler to store current markets and event
  const handleItemClick = useCallback((item: any) => {
    console.log(`\n=== Event: ${item.title || 'Untitled Event'} ===`);
    
    setSearchTerm('');
    setSelectedEventTitle(item.title || 'Untitled Event');
    setCurrentEvent(item);
    
    if (item.markets && item.markets.length > 0) {
      setCurrentMarkets(item.markets);
      const config = intervalConfigs[selectedInterval as keyof typeof intervalConfigs];
      fetchAndGraphMultipleTimeSeries(item.markets, config.interval, config.fidelity);
      
      // Trigger sentiment analysis
      performSentimentAnalysis(item.markets);
    }
  }, [fetchAndGraphMultipleTimeSeries, selectedInterval, intervalConfigs, performSentimentAnalysis]);

  return (
    <div className="min-h-screen bg-black">
      {/* Left Watchlist Ribbon - Persistent */}
      <div className="fixed left-0 top-0 h-full w-80 bg-black border-r border-white/10 overflow-y-auto overflow-x-hidden z-50">
        <div className="p-4">
          {/* Header */}
          <div className="mb-6">
            <h2 className="text-white text-lg font-semibold tracking-tight">Watchlist</h2>
          </div>
          
          {watchlist.length === 0 ? (
            <div className="text-center text-white/40 mt-12">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                <Plus className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium mb-2">Add events to your watchlist</p>
              <p className="text-xs text-white/30 leading-relaxed px-4">
                Track your favorite Polymarket events and stay updated on their performance
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {watchlist.map((event) => (
                <div key={event.id} className="group bg-white/5 hover:bg-white/8 rounded-xl p-4 border border-white/10 hover:border-white/20 transition-all duration-200">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <img 
                        src={event.image} 
                        alt={event.title}
                        className="w-10 h-10 rounded-full flex-shrink-0 object-cover ring-2 ring-white/10"
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-white text-sm font-medium  line-clamp-2 mb-2 group-hover:text-white/90 transition-colors">
                          {event.title}
                        </h4>
                        <div className="flex items-center space-x-4 text-xs text-white/50">
                          <div className="flex items-center space-x-1">
                            <TrendingUp className="w-3 h-3" />
                            <span className="">{event.markets?.length || 0} markets</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <DollarSign className="w-3 h-3" />
                            <span className="">
                              ${event.volume ? (event.volume > 1000000 ? `${(event.volume/1000000).toFixed(1)}M` : `${(event.volume/1000).toFixed(0)}K`) : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => removeFromWatchlist(event.id)}
                      className="text-white/30 hover:text-red-400 transition-colors ml-3 flex-shrink-0 p-1 rounded-md hover:bg-red-500/10"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    onClick={() => handleItemClick(event)}
                    className="w-full text-xs bg-white/10 hover:bg-white/20 text-white/80 hover:text-white py-2 px-3 rounded-lg transition-all  font-medium border border-white/10 hover:border-white/20"
                  >
                    View Details
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Sentiment Ribbon - Always Open */}
      <div className="fixed right-0 top-0 h-full w-80 bg-black border-l border-white/10 overflow-y-auto overflow-x-hidden z-50">
        <div className="p-4">
          <div className="mb-6">
            <div className="flex items-center space-x-2 mb-4">
              <h2 className="text-white text-lg font-semibold tracking-tight">Sentiment</h2>
              <div className="group relative">
                <HelpCircle className="w-4 h-4 text-white/40 hover:text-white/70 transition-colors cursor-pointer" />
                <div className="absolute top-full -left-20 mt-2 px-3 py-2 bg-black/95 backdrop-blur-sm border border-white/10 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-[60] w-72">
                  <div className="text-white text-xs font-medium leading-relaxed">
                    Link sentiments to markets for predictive alerts and useful visualizations
                  </div>
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-white/10"></div>
                </div>
              </div>
            </div>
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/40" />
              <input 
                className="w-full h-12 pl-12 pr-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-white/30 focus:bg-white/8 transition-all backdrop-blur-sm disabled:opacity-50"
                type="text"
                placeholder="Search sentiments"
                value={sentimentSearchTerm}
                onChange={handleSentimentSearch}
                disabled={loadingSentiment || sentimentResults.length === 0}
              />
              {/* Tooltip for disabled state */}
              {(loadingSentiment || sentimentResults.length === 0) && (
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black/95 backdrop-blur-sm border border-white/10 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-[60] whitespace-nowrap">
                  <div className="text-white text-xs font-medium leading-relaxed">
                    Select an event to generate sentiments!
                  </div>
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-white/10"></div>
                </div>
              )}
            </div>
          </div>
          {loadingSentiment ? (
            <div className="space-y-4 mt-4">
              <div className="text-xs text-white/60 space-y-1">
                <div>
                  {sentimentProgress.phase === 'generating' && 'Generating sentiment queries...'}
                  {sentimentProgress.phase === 'fetching' && 'Fetching GDELT sentiment data...'}
                  {sentimentProgress.phase === 'scoring' && 'Scoring market/sentiment alignment...'}
                  {sentimentProgress.phase === 'finalizing' && 'Finalizing results...'}
                </div>
                {sentimentProgress.totalMarkets > 0 && (
                  <div>
                    Markets {sentimentProgress.completedMarkets}/{sentimentProgress.totalMarkets}
                  </div>
                )}
                {sentimentProgress.totalQueries > 0 && (
                  <div>
                    Queries {sentimentProgress.completedQueries}/{sentimentProgress.totalQueries}
                  </div>
                )}
              </div>
              {/* Generate 8 skeleton components */}
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <Skeleton className="h-4 w-3/4 bg-white/10" />
                    <Skeleton className="h-6 w-16 bg-white/10 rounded-full" />
                  </div>
                  <div className="space-y-2 mb-3">
                    <Skeleton className="h-3 w-full bg-white/10" />
                    <Skeleton className="h-3 w-2/3 bg-white/10" />
                  </div>
                  <div className="flex flex-wrap gap-1 mb-3">
                    <Skeleton className="h-5 w-16 bg-white/10 rounded-full" />
                    <Skeleton className="h-5 w-20 bg-white/10 rounded-full" />
                    <Skeleton className="h-5 w-14 bg-white/10 rounded-full" />
                  </div>
                  <Skeleton className="h-8 w-full bg-white/10 rounded-lg" />
                </div>
              ))}
            </div>
          ) : filteredSentimentResults.length > 0 ? (
            <div className="space-y-3">
              {filteredSentimentResults.map((result, index) => (
                <div key={`${result.marketId}-${index}`} className="bg-white/5 hover:bg-white/8 rounded-xl p-4 border border-white/10 hover:border-white/20 transition-all duration-200">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-white text-sm font-medium line-clamp-2 mb-2">
                        {result.marketQuestion}
                      </h4>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {result.keywords.slice(0, 3).map((keyword, i) => (
                          <span key={i} className="text-xs bg-white/10 text-white/70 px-2 py-1 rounded">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 ml-3">
                      <div 
                        className={`w-3 h-3 rounded-full ${
                          result.correlation >= 70 ? 'bg-green-500' :
                          result.correlation >= 40 ? 'bg-orange-500' : 'bg-red-500'
                        }`}
                      />
                      <span className="text-white font-medium text-sm">
                        {result.correlation.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  
                  <div className="text-xs text-white/50 mb-3 line-clamp-2">
                    Query: {result.gdeltQuery}
                  </div>
                  
                  <div className="group relative">
                    <button
                      onClick={() => result.isLinked ? unlinkSentiment(result) : linkSentiment(result)}
                      disabled={!isInWatchlist(currentEvent?.id || '')}
                      className={`w-full text-xs py-2 px-3 rounded-lg transition-all font-medium border ${
                        result.isLinked
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30'
                          : !isInWatchlist(currentEvent?.id || '')
                          ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed'
                          : 'bg-white/10 hover:bg-white/20 text-white/80 hover:text-white border-white/10 hover:border-white/20'
                      }`}
                    >
                      {result.isLinked ? (
                        <>
                          <div className="inline-flex items-center">
                            <LinkIcon className="w-3 h-3 mr-1 group-hover:hidden" />
                            <Unlink className="w-3 h-3 mr-1 hidden group-hover:inline" />
                            <span className="group-hover:hidden">Linked</span>
                            <span className="hidden group-hover:inline">Unlink</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <LinkIcon className="w-3 h-3 mr-1 inline" />
                          Link Sentiment
                        </>
                      )}
                    </button>

                    
                    {/* Tooltip for inactive button */}
                    {!isInWatchlist(currentEvent?.id || '') && (
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black/95 backdrop-blur-sm border border-white/10 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 whitespace-nowrap">
                        <div className="text-white text-xs font-medium leading-relaxed">
                          Add event to watchlist first
                        </div>
                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-white/10"></div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : sentimentResults.length > 0 ? (
            <div className="text-center text-white/40 mt-12">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                <Search className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium">No sentiments found matching your search</p>
            </div>
          ) : (
            <div className="text-center text-white/40 mt-12">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                <TrendingUp className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium">Select an event to analyze sentiment</p>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="ml-80 mr-80 p-6">
        <div className="max-w-7xl mx-auto">
          {/* Search bar aligned with sidebar search */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/40" />
              <input 
                className="w-full h-12 pl-12 pr-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-white/30 focus:bg-white/8 transition-all  backdrop-blur-sm"
                type="text"
                placeholder={loadingEvents ? "Loading Polymarket events..." : "Search for Polymarket events"}
                value={searchTerm}
                onChange={handleSearch}
              />
            </div>
            {loadingEvents && (
              <div className="text-xs text-white/60 mt-2">
                Loading events... {loadedEventsCount > 0 ? `${loadedEventsCount} loaded` : ''}
              </div>
            )}
          </div>

          {searchResults.length > 0 && (
            <div className="relative w-full z-40 mb-6">
              <div className="absolute top-0 left-0 right-0 bg-black/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl max-h-96 overflow-y-auto">
                {searchResults.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center p-4 border-b border-white/10 last:border-b-0 hover:bg-white/5 cursor-pointer transition-all duration-200 group"
                    onClick={() => handleItemClick(item)}
                  >
                    <img 
                      src={item.image} 
                      alt={item.title}
                      className="w-12 h-12 rounded-full flex-shrink-0 mr-4 object-cover ring-2 ring-white/10 group-hover:ring-white/20 transition-all"
                    />
                    <span className="text-white font-medium  group-hover:text-white/90 transition-colors">{item.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Welcome Screen */}
          {!currentEvent && searchResults.length === 0 && searchTerm.length === 0 && (
            <div className="flex items-center justify-center h-96">
              <div className="text-center">
                <h1 className="text-8xl font-bold mb-8 bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent animate-pulse relative">
                  <span className="relative z-10">SHAMAN</span>
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent animate-ping opacity-20"></div>
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent animate-pulse opacity-40"></div>
                </h1>
                <div className="text-2xl text-white/80 mb-4 animate-bounce">
                  Say hello to Shaman
                </div>
                <div className="w-32 h-1 bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 mx-auto rounded-full animate-pulse"></div>
                <div className="mt-8 text-sm text-white/40 animate-pulse">
                  Beat prediction markets with AI-powered sentiment analysis. Search to get started :D
                </div>
              </div>
            </div>
          )}
          
          {renderTimeSeriesGraph}
        </div>
      </div>
    </div>
  );
}

export default App;
