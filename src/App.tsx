import React, { useState, useEffect } from 'react';
import Fuse from "fuse.js";

function App() {
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState(data);

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
        <div className="relative w-full">
          <div className="absolute top-0 left-0 right-0 bg-black border border-gray-600 rounded-lg shadow-lg max-h-96 overflow-y-auto z-10">
            {searchResults.slice(0, 10).map(item => (
              <div
                key={item.id}
                className="flex items-center p-3 border-b border-gray-700 last:border-b-0 hover:bg-gray-700 cursor-pointer transition-colors duration-200"
                onClick={() => {
                  console.log(`\n=== Event: ${item.title || 'Untitled Event'} ===`);
                  
                  if (item.markets && item.markets.length > 0) {
                    item.markets.forEach((market: { question: any; clobTokenIds: any; }, index: number) => {
                      console.log(`Market ${index + 1}:`);
                      console.log(`  Question: ${market.question || 'No question available'}`);
                      console.log(`  CLOB Token IDs: ${market.clobTokenIds || 'No CLOB IDs available'}`);
                    });
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
    </div>
  );
}

export default App;