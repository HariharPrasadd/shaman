import React, { useState, useEffect } from 'react';
import Fuse from "fuse.js";

function App() {
  const [data, setData] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState(data);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);

  useEffect(() => {
    const fetchAll = async () => {
      const limit = 500;
      let offset = 0;
      let allData: React.SetStateAction<any[]> = [];
      while (true) {
        const response = await fetch(`https://gamma-api.polymarket.com/events?closed=false&limit=${limit}&offset=${offset}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          mode: 'cors',
        });
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

  const handleEventClick = (item: any) => {
    setSelectedEvent(item);
    setSearchResults([]); // Clear search results when an event is selected
  };
  
  return (
    <div className="flex flex-col items-center p-4 bg-black min-h-screen">
      <input 
        className="my-4 p-3 border border-gray-600 rounded-lg w-full bg-black text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
        type="text"
        placeholder="Search for Polymarket events"
        onChange={handleSearch}
      />
      
      {/* Search Results - High z-index to overlay everything */}
      {searchResults.length > 0 && (
        <div className="relative w-full">
          <div className="absolute top-0 left-0 right-0 bg-black border border-gray-600 rounded-lg shadow-lg max-h-96 overflow-y-auto z-50">
            {searchResults.slice(0, 10).map(item => (
              <div
                key={item.id}
                className="flex items-center p-3 border-b border-gray-700 last:border-b-0 hover:bg-gray-700 cursor-pointer transition-colors duration-200"
                onClick={() => handleEventClick(item)}
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

      {/* Selected Event Display */}
      {selectedEvent && (
        <div className="w-full mt-8">
          {/* Event Header */}
          <div className="flex items-center mb-6 p-4 border border-gray-600 rounded-lg bg-black">
            <img 
              src={selectedEvent.image} 
              alt={selectedEvent.title}
              className="w-16 h-16 rounded-full flex-shrink-0 mr-4 object-cover"
            />
            <div>
              <h2 className="text-white text-xl font-bold">{selectedEvent.title}</h2>
              <button 
                onClick={() => setSelectedEvent(null)}
                className="text-gray-400 hover:text-white mt-2 text-sm"
              >
                ← Back to search
              </button>
            </div>
          </div>

          {/* Markets Display */}
          {selectedEvent.markets && selectedEvent.markets.length > 0 ? (
            <div className="space-y-4">
              {selectedEvent.markets.map((market: { question: any; clobTokenIds: any; groupItemTitle: any; outcomePrices: any; volumeNum: any;}, index: number) => {
                console.log(selectedEvent.id);
                const probability = market.outcomePrices ? JSON.parse(market.outcomePrices)[0] * 100 : 0;
                return (
                  <div key={index} className="border border-gray-600 rounded-lg bg-black p-4">
                    <h3 className="text-white text-lg font-semibold mb-4">
                      {market.question || `Market ${index + 1}`}
                    </h3>
                    
                    {/* Three Column Layout */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Outcome Column */}
                      <div className="bg-gray-900 p-3 rounded-lg">
                        <div className="text-gray-400 text-sm font-medium mb-1">Outcome</div>
                        <div className="text-white font-semibold">
                          {market.groupItemTitle || 'Yes'}
                        </div>
                      </div>

                      {/* Volume Column */}
                      <div className="bg-gray-900 p-3 rounded-lg">
                        <div className="text-gray-400 text-sm font-medium mb-1">Volume</div>
                        <div className="text-white font-semibold">
                          ${market.volumeNum ? market.volumeNum.toFixed(0) : 'No volume available'}
                        </div>
                      </div>

                      {/* Probability Column */}
                      <div className="bg-gray-900 p-3 rounded-lg">
                        <div className="text-gray-400 text-sm font-medium mb-1">% Chance</div>
                        <div className="text-white font-semibold">
                          {probability ? `${probability.toFixed(1)}%` : 'No probability available'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border border-gray-600 rounded-lg bg-black p-4">
              <p className="text-gray-400">No markets found for this event</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;