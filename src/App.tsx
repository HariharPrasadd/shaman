import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Fuse from "fuse.js";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { X, Plus, TrendingUp, DollarSign } from 'lucide-react';

function App() {
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
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
    fetchAll().catch(err => setError(err.message));
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

  // Modified to create dataset for top 5 series
  const createOptimizedDataset = useCallback((allSeries: any[]) => {
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
          
          dataPoint[`series${seriesIndex}`] = closestPoint.p;
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
      
      // Fetch all series data with specified interval and fidelity
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
    return createOptimizedDataset(allTimeSeries);
  }, [allTimeSeries, createOptimizedDataset]);

  // Memoize the entire chart component with responsive tooltip
  const renderTimeSeriesGraph = useMemo(() => {
    if (allTimeSeries.length === 0) return null;

    // Expanded color palette for 5 series
    const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1'];

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
          <div className="bg-black border border-gray-600 p-2 rounded-lg max-w-xs text-xs">
            <p className="text-white mb-2 font-semibold text-sm">{formattedDate}</p>
            {payload
              .filter((entry: any) => entry.value !== undefined)
              .map((entry: any, index: number) => {
                const seriesIndex = parseInt(entry.dataKey.replace('series', ''));
                const series = allTimeSeries[seriesIndex];
                if (series) {
                  const probability = (entry.value * 100).toFixed(1);
                  return (
                    <p key={index} style={{ color: entry.color }} className="text-xs mb-1 leading-tight">
                      <span className="font-medium block truncate">{series.groupItemTitle}</span>
                      <span className="text-xs opacity-90">{probability}%</span>
                    </p>
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
      <div className="w-full mt-8 bg-gray-900 p-6 rounded-lg">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-white text-xl font-bold">
            {selectedEventTitle || 'Price History'}
            {loadingPrices && <span className="ml-2 text-sm text-gray-400">Loading...</span>}
          </h3>
          
          {/* Interval buttons */}
          <div className="flex gap-2">
            {['1h', '6h', '1d', '1w', '1m'].map((interval) => (
              <button
                key={interval}
                onClick={() => handleIntervalChange(interval)}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  selectedInterval === interval
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {interval}
              </button>
            ))}
          </div>
        </div>
        
        <ResponsiveContainer width="100%" height={500}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="timestamp" 
              stroke="#9CA3AF"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(timestamp) => {
                const date = new Date(timestamp);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              }}
            />
            <YAxis 
              stroke="#9CA3AF"
              domain={[0, 1]}
              tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
            />
            <Tooltip content={customTooltip} />
            <Legend 
              formatter={(value) => {
                const seriesIndex = parseInt(value.replace('series', ''));
                const series = allTimeSeries[seriesIndex];
                return series ? (
                  <span className="text-sm">
                    {series.groupItemTitle} ({(series.latestPrice * 100).toFixed(1)}%)
                  </span>
                ) : value;
              }}
              wrapperStyle={{ paddingTop: '20px' }}
            />
            {allTimeSeries.map((_, index) => (
              <Line
                key={index}
                type="monotone"
                dataKey={`series${index}`}
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                dot={false}
                connectNulls={true}
                strokeLinecap="round"
                strokeLinejoin="round"
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        
        {/* Responsive summary of top 5 markets */}
        {allTimeSeries.length > 0 && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {allTimeSeries.map((series, index) => (
              <div 
                key={index} 
                className="bg-gray-800 p-2 rounded-lg border-l-4 text-xs"
                style={{ borderLeftColor: colors[index % colors.length] }}
              >
                <h4 className="text-white font-semibold text-xs mb-1 line-clamp-2">
                  #{index + 1}: {series.groupItemTitle}
                </h4>
                <p className="text-gray-300 text-xs">
                  Current: {(series.latestPrice * 100).toFixed(1)}%
                </p>
                <p className="text-gray-400 text-xs">
                  Vol: ${series.volumeNum ? (series.volumeNum > 1000 ? `${(series.volumeNum/1000).toFixed(0)}K` : series.volumeNum.toLocaleString()) : 'N/A'}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Add to Watchlist Button */}
        {currentEvent && (
          <div className="mt-6 text-center">
            <button
              onClick={() => addToWatchlist(currentEvent)}
              disabled={isInWatchlist(currentEvent.id)}
              className={`px-6 py-2 rounded-lg font-medium transition-all ${
                isInWatchlist(currentEvent.id)
                  ? 'bg-green-600 text-white cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isInWatchlist(currentEvent.id) ? (
                <>✓ Added to Watchlist</>
              ) : (
                <>+ Add to Watchlist</>
              )}
            </button>
          </div>
        )}
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
    <div className="flex min-h-screen bg-black">
      {/* Left Watchlist Ribbon */}
      <div className="fixed left-0 top-0 h-full w-64 bg-gray-900 border-r border-gray-700 overflow-y-auto z-40">
        <div className="p-4">
          <h2 className="text-white text-lg font-bold mb-4">Watchlist</h2>
          
          {watchlist.length === 0 ? (
            <div className="text-center text-gray-400 mt-8">
              <Plus className="mx-auto mb-2 w-8 h-8 opacity-50" />
              <p className="text-sm font-medium">Add events to your watchlist</p>
              <p className="text-xs mt-1">Track your favorite Polymarket events and stay updated on their performance</p>
            </div>
          ) : (
            <div className="space-y-3">
              {watchlist.map((event) => (
                <div key={event.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <img 
                        src={event.image} 
                        alt={event.title}
                        className="w-8 h-8 rounded-full flex-shrink-0 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-white text-sm font-medium line-clamp-2 mb-1">
                          {event.title}
                        </h4>
                        <div className="flex items-center space-x-2 text-xs text-gray-400">
                          <div className="flex items-center space-x-1">
                            <TrendingUp className="w-3 h-3" />
                            <span>{event.markets?.length || 0} markets</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <DollarSign className="w-3 h-3" />
                            <span>${event.volume ? (event.volume > 1000000 ? `${(event.volume/1000000).toFixed(1)}M` : `${(event.volume/1000).toFixed(0)}K`) : 'N/A'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => removeFromWatchlist(event.id)}
                      className="text-gray-400 hover:text-red-400 transition-colors ml-2 flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    onClick={() => handleItemClick(event)}
                    className="w-full mt-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 py-1 px-2 rounded transition-colors"
                  >
                    View Details
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Sentiment Ribbon */}
      <div className="fixed right-0 top-0 h-full w-64 bg-gray-900 border-l border-gray-700 overflow-y-auto z-40">
        <div className="p-4">
          <div className="mb-4">
            <input 
              className="w-full p-2 border border-gray-600 rounded-lg bg-black text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
              type="text"
              placeholder="Search for market sentiment"
            />
          </div>
          <div className="text-center text-gray-400 mt-8">
            <p className="text-sm">Sentiment analysis coming soon...</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 ml-64 mr-64 p-4">
        <input 
          className="my-4 p-3 border border-gray-600 rounded-lg w-full bg-black text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          type="text"
          placeholder="Search for Polymarket events"
          value={searchTerm}
          onChange={handleSearch}
        />
        {searchResults.length > 0 && (
          <div className="relative w-full z-50">
            <div className="absolute top-0 left-0 right-0 bg-black border border-gray-600 rounded-lg shadow-lg max-h-96 overflow-y-auto z-50">
              {searchResults.map(item => (
                <div
                  key={item.id}
                  className="flex items-center p-3 border-b border-gray-700 last:border-b-0 hover:bg-gray-700 cursor-pointer transition-colors duration-200"
                  onClick={() => handleItemClick(item)}
                >
                  <img 
                    src={item.image} 
                    alt={item.title}
                    className="w-10 h-10 rounded-full flex-shrink-0 mr-3 object-cover"
                  />
                  <span className="text-white font-medium">{item.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {renderTimeSeriesGraph}
      </div>
    </div>
  );
}

export default App;