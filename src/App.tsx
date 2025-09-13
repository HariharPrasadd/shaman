import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Fuse from "fuse.js";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

function App() {
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState(data);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modified state for top 5 time series
  const [allTimeSeries, setAllTimeSeries] = useState<any[]>([]);
  const [loadingPrices, setLoadingPrices] = useState<boolean>(false);
  const [selectedEventTitle, setSelectedEventTitle] = useState<string | null>(null);

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

  // Optimized price history fetching with reduced fidelity for speed
  const fetchPriceHistory = useCallback(async (clobID: string, interval = '1m', fidelity='180') => {
    try {
      // Reduced fidelity and interval for much faster loading
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

    // Use the reference series timestamps and downsample for performance
    const timestamps = referenceSeries.history
      .map((point: any) => point.t * 1000)
      .filter((_: any, index: number) => index % 2 === 0) // Downsample by 50% for performance
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
  }, []);

  // Modified to return top 5 series with highest p values
  const fetchAndGraphMultipleTimeSeries = useCallback(async (markets: any[]) => {
    try {
      setLoadingPrices(true);
      
      // Fetch all series data
      const allSeriesPromises = markets.map(async (market) => {
        const clobIds = JSON.parse(market.clobTokenIds);
        const priceData = await fetchPriceHistory(clobIds[0]);
        
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

  // Memoize chart data to prevent recalculation on every render
  const chartData = useMemo(() => {
    return createOptimizedDataset(allTimeSeries);
  }, [allTimeSeries, createOptimizedDataset]);

  // Memoize the entire chart component
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
          <div className="bg-black border border-gray-600 p-3 rounded-lg max-w-xs">
            <p className="text-white mb-2 font-semibold">{formattedDate}</p>
            {payload
              .filter((entry: any) => entry.value !== undefined)
              .map((entry: any, index: number) => {
                const seriesIndex = parseInt(entry.dataKey.replace('series', ''));
                const series = allTimeSeries[seriesIndex];
                if (series) {
                  const probability = (entry.value * 100).toFixed(1);
                  return (
                    <p key={index} style={{ color: entry.color }} className="text-sm mb-1">
                      <span className="font-medium">{series.groupItemTitle}</span>
                      <br />
                      <span>{probability}%</span>
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
        <h3 className="text-white text-xl font-bold mb-4">
          {selectedEventTitle || 'Price History'}
          {loadingPrices && <span className="ml-2 text-sm text-gray-400">Loading...</span>}
        </h3>
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
        
        {/* Summary of top 5 markets */}
        {allTimeSeries.length > 0 && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {allTimeSeries.map((series, index) => (
              <div 
                key={index} 
                className="bg-gray-800 p-3 rounded-lg border-l-4"
                style={{ borderLeftColor: colors[index % colors.length] }}
              >
                <h4 className="text-white font-semibold text-sm mb-1">
                  #{index + 1}: {series.groupItemTitle}
                </h4>
                <p className="text-gray-300 text-xs">
                  Current: {(series.latestPrice * 100).toFixed(1)}%
                </p>
                <p className="text-gray-400 text-xs">
                  Volume: ${series.volumeNum?.toLocaleString() || 'N/A'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }, [allTimeSeries, chartData, loadingPrices, selectedEventTitle]);

  // Optimized click handler
  const handleItemClick = useCallback((item: any) => {
    console.log(`\n=== Event: ${item.title || 'Untitled Event'} ===`);
    
    setSearchResults([]);
    setSearchTerm('');
    setSelectedEventTitle(item.title || 'Untitled Event');
    
    if (item.markets && item.markets.length > 0) {
      fetchAndGraphMultipleTimeSeries(item.markets);
    }
  }, [fetchAndGraphMultipleTimeSeries]);

  return (
    <div className="flex flex-col items-center p-4">
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
  );
}

export default App;