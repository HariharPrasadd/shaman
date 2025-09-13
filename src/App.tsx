import React, { useState, useEffect } from 'react';
import Fuse from "fuse.js";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

function App() {
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState(data);
  
  // Added state variables for price history
  const [timeSeries, setTimeSeries] = useState<any[]>([]);
  const [loadingPrices, setLoadingPrices] = useState<boolean>(false);
  const [allTimeSeries, setAllTimeSeries] = useState<any[]>([]);
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

  // Added function to fetch price history
  const fetchPriceHistory = async (clobID: string, interval = '1m', fidelity = 10) => {
    try {
      console.log(`Fetching price history for CLOB ID: ${clobID}`);
      setLoadingPrices(true);
      
      const response = await fetch(
        `https://clob.polymarket.com/prices-history?market=${clobID}&interval=${interval}&fidelity=${fidelity}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const priceData = await response.json();
      
      // Store the data in state
      setTimeSeries(priceData);
      
      return priceData;
      
    } catch (error) {
      console.error(`Error fetching price history for CLOB ID ${clobID}:`, error);
      return null;
    } finally {
      setLoadingPrices(false);
    }
  };

  // Helper function to interpolate missing values
  const interpolateValue = (prevValue: number, nextValue: number, prevTime: number, nextTime: number, currentTime: number) => {
    if (prevValue === undefined || nextValue === undefined) return prevValue || nextValue;
    const ratio = (currentTime - prevTime) / (nextTime - prevTime);
    return prevValue + (nextValue - prevValue) * ratio;
  };

  // Function to create synchronized and interpolated dataset
  const createSynchronizedDataset = (allSeries: any[]) => {
    // Collect all unique timestamps
    const allTimestamps = new Set<number>();
    allSeries.forEach(series => {
      series.history.forEach((point: any) => {
        allTimestamps.add(point.t * 1000); // Convert to milliseconds
      });
    });

    // Sort timestamps
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    // Create base dataset with all timestamps
    const synchronizedData = sortedTimestamps.map(timestamp => ({ timestamp }));

    // Fill in data for each series with interpolation
    allSeries.forEach((series, seriesIndex) => {
      const seriesData = series.history.map((point: any) => ({
        timestamp: point.t * 1000,
        price: point.p
      })).sort((a: any, b: any) => a.timestamp - b.timestamp);

      synchronizedData.forEach((dataPoint, pointIndex) => {
        const timestamp = dataPoint.timestamp;
        
        // Find exact match first
        const exactMatch = seriesData.find((sp: any) => sp.timestamp === timestamp);
        if (exactMatch) {
          (dataPoint as any)[`series${seriesIndex}`] = exactMatch.price;
          return;
        }

        // Find surrounding points for interpolation
        const beforePoint = seriesData.filter((sp: any) => sp.timestamp < timestamp).pop();
        const afterPoint = seriesData.find((sp: any) => sp.timestamp > timestamp);

        if (beforePoint && afterPoint) {
          // Interpolate between points
          const interpolatedValue = interpolateValue(
            beforePoint.price,
            afterPoint.price,
            beforePoint.timestamp,
            afterPoint.timestamp,
            timestamp
          );
          (dataPoint as any)[`series${seriesIndex}`] = interpolatedValue;
        } else if (beforePoint) {
          // Use last known value (forward fill)
          (dataPoint as any)[`series${seriesIndex}`] = beforePoint.price;
        } else if (afterPoint) {
          // Use next known value (backward fill)
          (dataPoint as any)[`series${seriesIndex}`] = afterPoint.price;
        }
      });
    });

    return synchronizedData;
  };

  // Function to fetch multiple time series and generate graph
  const fetchAndGraphMultipleTimeSeries = async (markets: any[]) => {
    try {
      setLoadingPrices(true);
      const allSeriesPromises = markets.map(async (market) => {
        const clobIds = JSON.parse(market.clobTokenIds);
        const priceData = await fetchPriceHistory(clobIds[0]);
        
        if (priceData && priceData.history) {
          return {
            question: market.question,
            clobTokenIds: market.clobTokenIds,
            groupItemTitle: market.groupItemTitle,
            outcomePrices: JSON.parse(market.outcomePrices)[0],
            volumeNum: market.volumeNum,
            history: priceData.history,
            latestPrice: priceData.history.length > 0 ? priceData.history[priceData.history.length - 1].p : 0
          };
        }
        return null;
      });

      const allSeries = (await Promise.all(allSeriesPromises)).filter(series => series !== null);
      
      // Sort by latest price and take top 5
      const top5Series = allSeries
        .sort((a, b) => b.latestPrice - a.latestPrice)
        .slice(0, 5);

      setAllTimeSeries(top5Series);
      
    } catch (error) {
      console.error('Error fetching multiple time series:', error);
    } finally {
      setLoadingPrices(false);
    }
  };

  // Function to render the graph
  const renderTimeSeriesGraph = () => {
    if (allTimeSeries.length === 0) return null;

    // Use the new synchronized dataset creation
    const chartData = createSynchronizedDataset(allTimeSeries);

    const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00ff00'];

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
          <div className="bg-black border border-gray-600 p-3 rounded-lg">
            <p className="text-white mb-2">{formattedDate}</p>
            {payload.map((entry: any, index: number) => {
              const seriesIndex = parseInt(entry.dataKey.replace('series', ''));
              const series = allTimeSeries[seriesIndex];
              if (series && entry.value !== undefined) {
                const probability = (entry.value * 100).toFixed(2);
                return (
                  <p key={index} style={{ color: entry.color }}>
                    <span className="font-semibold">{series.groupItemTitle}</span>
                    <br />
                    <span>Price: {entry.value.toFixed(4)}</span>
                    <br />
                    <span>Probability: {probability}%</span>
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
        <h3 className="text-white text-xl font-bold mb-4">Price History (Top 5 Markets)</h3>
        <ResponsiveContainer width="100%" height={400}>
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
              formatter={(value, entry) => {
                const seriesIndex = parseInt(value.replace('series', ''));
                const series = allTimeSeries[seriesIndex];
                return series ? series.groupItemTitle : value;
              }}
            />
            {allTimeSeries.map((_, index) => (
              <Line
                key={index}
                type="monotone"
                dataKey={`series${index}`}
                stroke={colors[index]}
                strokeWidth={2}
                dot={false}
                connectNulls={true}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const options = {
    includeScore: true,
    includeMatches: true,
    threshold: 0.2,
    keys: ["title"],
  }
  const fuse = new Fuse(data, options);
  const handleSearch = (event: { target: { value: any; }; }) => {
    const { value } = event.target;
    // If the user searched for an empty string,
    // display all data.
    if (value.length === 0) {
      setSearchResults([]);
      return;
    }
    const results = fuse.search(value);
    const items = results.map((result) => result.item);
    setSearchResults(items);
  };
  
  return (
    <div className = "flex flex-col items-center p-4">
      <input 
        className="my-4 p-3 border border-gray-600 rounded-lg w-full bg-black text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
        type="text"
        placeholder="Search for Polymarket events"
        onChange={handleSearch}
      />
      {searchResults.length > 0 && (
        <div className="relative w-full z-50">
          <div className="absolute top-0 left-0 right-0 bg-black border border-gray-600 rounded-lg shadow-lg max-h-96 overflow-y-auto z-50">
            {searchResults.slice(0, 10).map(item => (
              <div
                key={item.id}
                className="flex items-center p-3 border-b border-gray-700 last:border-b-0 hover:bg-gray-700 cursor-pointer transition-colors duration-200"
                onClick={() => {
                  console.log(`\n=== Event: ${item.title || 'Untitled Event'} ===`);
                  
                  // Clear search results and set selected event title
                  setSearchResults([]);
                  setSelectedEventTitle(item.title || 'Untitled Event');
                  
                  if (item.markets && item.markets.length > 0) {
                    item.markets.forEach((market: { question: any; clobTokenIds: any; }, index: number) => {
                      console.log(`Market ${index + 1}:`);
                      console.log(`  Question: ${market.question || 'No question available'}`);
                      console.log(`  CLOB Token IDs: ${JSON.parse(market.clobTokenIds)[0] || 'No CLOB IDs available'}`);
                      fetchPriceHistory(JSON.parse(market.clobTokenIds)[0]);
                      console.log(` Time Series: `, timeSeries);
                    });
                    
                    // Fetch and graph multiple time series
                    fetchAndGraphMultipleTimeSeries(item.markets);
                  } else {
                    console.log('No markets found for this event');
                  }
                }}
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
      {renderTimeSeriesGraph()}
    </div>
  );
}
export default App;