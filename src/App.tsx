import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Fuse from "fuse.js";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { X, Plus, TrendingUp, DollarSign, Search } from 'lucide-react';

function App() {
  const [data, setData] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState(data);
  const [searchTerm, setSearchTerm] = useState('');
  
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
    const fetchAll = async () => {
      const limit = 500;
      let offset = 0;
      let allData: React.SetStateAction<any[]> = [];
      while (true) {
        const response = await fetch(`/api/events?closed=false&limit=${limit}&offset=${offset}`);
        const batch = await response.json();
        if (!batch || batch.length === 0) break;
        allData = allData.concat(batch);
        if (batch.length < limit) break;
        offset += limit;
      }
      setData(allData);
    };
    fetchAll().catch(err => console.error('Failed to fetch data:', err));
  }, []);

  // Memoize Fuse instance to avoid recreating it on every render
  const fuse = useMemo(() => {
    const options = {
      includeScore: true,
      includeMatches: true,
      threshold: 0.2,
      keys: ["title"],
    };
    return new Fuse(data, options);
  }, [data]);

  // Debounced search with useMemo for performance
  const debouncedSearchResults = useMemo(() => {
    if (searchTerm.length === 0) return [];
    const results = fuse.search(searchTerm);
    return results.map((result) => result.item).slice(0, 10);
  }, [searchTerm, fuse]);

  // Optimized search handler with debouncing
  const handleSearch = useCallback((event: { target: { value: string; }; }) => {
    const { value } = event.target;
    setSearchTerm(value);
    setSearchResults(value.length === 0 ? [] : debouncedSearchResults);
  }, [debouncedSearchResults]);

  // Modified price history fetching to accept interval and fidelity parameters
  const fetchPriceHistory = useCallback(async (clobID: string, interval = '1m', fidelity='180') => {
    try {
      const response = await fetch(
        `https://clob.polymarket.com/prices-history?market=${clobID}&interval=${interval}&fidelity=${fidelity}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const priceData = await response.json();
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

    // Use the reference series timestamps and downsample for performance (except for shorter intervals)
    const shouldDownsample = selectedInterval === '1w' || selectedInterval === '1d';
    const timestamps = referenceSeries.history
      .map((point: any) => point.t * 1000)
      .filter((_: any, index: number) => !shouldDownsample || index % 2 === 0)
      .sort((a: number, b: number) => a - b);

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
      
      // Check if there's only one market (yes/no market)
      const isSingleMarket = markets.length === 1;
      
      if (isSingleMarket) {
        // For single market, fetch both CLOB IDs (Yes and No)
        const market = markets[0];
        const clobIds = JSON.parse(market.clobTokenIds);
        
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
        // Original logic for multiple markets
        const allSeriesPromises = markets.map(async (market) => {
          const clobIds = JSON.parse(market.clobTokenIds);
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
        
        // Filter out any null or undefined series just in case, then sort by latest price
        const validSeries = allSeries.filter((series): series is typeof allSeries[0] & { latestPrice: number } => !!series && typeof series.latestPrice === 'number');
        const top5Series = validSeries
          .sort((a, b) => b.latestPrice - a.latestPrice)
          .slice(0, 5);

        setAllTimeSeries(top5Series);
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

  // Memoize chart data to prevent recalculation on every render
  const chartData = useMemo(() => {
    const isSingleMarket = currentMarkets.length === 1;
    return createOptimizedDataset(allTimeSeries, isSingleMarket);
  }, [allTimeSeries, createOptimizedDataset, currentMarkets.length]);

  // Memoize the entire chart component with responsive tooltip
  const renderTimeSeriesGraph = useMemo(() => {
    if (allTimeSeries.length === 0) return null;

    // Fey-inspired color palette - more subtle and professional
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

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
                const seriesIndex = parseInt(entry.dataKey.replace('series', ''));
                const series = allTimeSeries[seriesIndex];
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
                <div className="flex items-center mt-2">
                  <div className="animate-spin w-4 h-4 border-2 border-white/20 border-t-white rounded-full mr-2" />
                  <span className="text-white/60 text-sm ">Loading market data...</span>
                </div>
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
                  formatter={(value) => {
                    const seriesIndex = parseInt(value.replace('series', ''));
                    const series = allTimeSeries[seriesIndex];
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
                    dataKey={`series${index}`}
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
              </LineChart>
            </ResponsiveContainer>
          </div>
          
          {/* Market summary cards with Fey-inspired design */}
          {allTimeSeries.length > 0 && (
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
  }, [allTimeSeries, chartData, loadingPrices, selectedEventTitle, selectedInterval, handleIntervalChange, currentEvent, addToWatchlist, isInWatchlist]);

  // Modified click handler to store current markets and event
  const handleItemClick = useCallback((item: any) => {
    console.log(`\n=== Event: ${item.title || 'Untitled Event'} ===`);
    
    setSearchResults([]);
    setSearchTerm('');
    setSelectedEventTitle(item.title || 'Untitled Event');
    setCurrentEvent(item);
    
    if (item.markets && item.markets.length > 0) {
      setCurrentMarkets(item.markets);
      const config = intervalConfigs[selectedInterval as keyof typeof intervalConfigs];
      fetchAndGraphMultipleTimeSeries(item.markets, config.interval, config.fidelity);
    }
  }, [fetchAndGraphMultipleTimeSeries, selectedInterval, intervalConfigs]);

  return (
    <div className="min-h-screen bg-black">
      {/* Left Watchlist Ribbon - Persistent */}
      <div className="fixed left-0 top-0 h-full w-80 bg-black border-r border-white/10 overflow-y-auto z-50">
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
      <div className="fixed right-0 top-0 h-full w-80 bg-black border-l border-white/10 overflow-y-auto z-50">
        <div className="p-4">
          <div className="mb-6">
            <h2 className="text-white text-lg font-semibold  tracking-tight mb-4">Sentiment</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/40" />
              <input 
                className="w-full h-11 pl-10 pr-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-white/30 focus:bg-white/8 transition-all  text-sm"
                type="text"
                placeholder="Search for market sentiment"
              />
            </div>
          </div>
          <div className="text-center text-white/40 mt-12">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
              <TrendingUp className="w-6 h-6" />
            </div>
            <p className="text-sm  font-medium">Sentiment analysis coming soon...</p>
          </div>
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
                placeholder="Search for Polymarket events"
                value={searchTerm}
                onChange={handleSearch}
              />
            </div>
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
          
          {renderTimeSeriesGraph}
        </div>
      </div>
    </div>
  );
}

export default App;