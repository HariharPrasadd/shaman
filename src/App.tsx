import React, { useState, useEffect } from 'react';

function App() {
  const [data, setData] = useState('');

  useEffect(() => {
    fetch('/api/events?limit=1')
      .then(response => response.json())
      .then(data => {
        setData(JSON.stringify(data, null, 2));
      })
      .catch(error => {
        setData(`Error: ${error.message}`);
      });
  }, []);

  return (
    <div>
      <pre>{data}</pre>
    </div>
  );
}

export default App;