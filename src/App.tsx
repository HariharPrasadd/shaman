import React, { useState, useEffect } from 'react';

function App() {
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
  fetch('/api/events?closed=false&limit=1000')
    .then(response => response.json())
    .then(data => {
      setData(data); // always an array
    })
    .catch(err => {
      setError(err.message); // keep errors in separate state
    });
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