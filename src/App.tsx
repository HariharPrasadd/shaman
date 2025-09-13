import React, { useState, useEffect } from 'react';

function App() {
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

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


  return (
    <div>
      {error && <p className="text-red-500">Error: {error}</p>}
      {data.length > 0 ? (
        data.map((item, index) => (
          <div key={item.id} className="mb-4 p-4 border rounded">
            <h2>{index+1}. {item.title}</h2>
          </div>
        ))
      ) : !error ? (
        <p>Loading...</p>
      ) : <p>Error: 404.</p>}
    </div>
  );
}

export default App;