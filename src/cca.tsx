import React, { useEffect, useState } from 'react';

interface TimeSeriesData {
  timestamp?: string | number;
  value: number;
  [key: string]: any;
}

interface CCAProps {
  seriesA: TimeSeriesData[];
  seriesB: TimeSeriesData[];
  onCorrelationCalculated: (correlation: number) => void;
  maxLag?: number;
}

const CCA: React.FC<CCAProps> = ({ 
  seriesA, 
  seriesB, 
  onCorrelationCalculated, 
  maxLag = 10 
}) => {
  const [correlation, setCorrelation] = useState<number>(0);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);

  // Extract numeric values from the data
  const extractValues = (data: TimeSeriesData[]): number[] => {
    return data.map(item => {
      // If the data has a 'value' field, use it
      if (typeof item.value === 'number') return item.value;
      
      // Otherwise, find the first numeric field that isn't timestamp
      for (const [key, val] of Object.entries(item)) {
        if (key !== 'timestamp' && typeof val === 'number') {
          return val;
        }
      }
      return 0; // fallback
    });
  };

  // Calculate mean of an array
  const mean = (arr: number[]): number => {
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
  };

  // Calculate standard deviation
  const standardDeviation = (arr: number[]): number => {
    const avg = mean(arr);
    const squareDiffs = arr.map(val => Math.pow(val - avg, 2));
    return Math.sqrt(mean(squareDiffs));
  };

  // Normalize array (z-score normalization)
  const normalize = (arr: number[]): number[] => {
    const avg = mean(arr);
    const std = standardDeviation(arr);
    if (std === 0) return arr.map(() => 0);
    return arr.map(val => (val - avg) / std);
  };

  // Calculate Pearson correlation coefficient
  const calculateCorrelation = (x: number[], y: number[]): number => {
    if (x.length !== y.length || x.length === 0) return 0;
    
    const meanX = mean(x);
    const meanY = mean(y);
    
    let numerator = 0;
    let sumXSquared = 0;
    let sumYSquared = 0;
    
    for (let i = 0; i < x.length; i++) {
      const diffX = x[i] - meanX;
      const diffY = y[i] - meanY;
      numerator += diffX * diffY;
      sumXSquared += diffX * diffX;
      sumYSquared += diffY * diffY;
    }
    
    const denominator = Math.sqrt(sumXSquared * sumYSquared);
    return denominator === 0 ? 0 : numerator / denominator;
  };

  // Shift series by lag amount
  const shiftSeries = (series: number[], lag: number): number[] => {
    if (lag > 0) {
      // Positive lag: remove first 'lag' elements, pad end with zeros
      return [...series.slice(lag), ...new Array(lag).fill(0)];
    } else if (lag < 0) {
      // Negative lag: pad beginning with zeros, remove last 'lag' elements
      return [...new Array(Math.abs(lag)).fill(0), ...series.slice(0, lag)];
    }
    return [...series]; // No shift for lag = 0
  };

  // Perform cross-correlation analysis
  const crossCorrelationAnalysis = (valuesA: number[], valuesB: number[]): number => {
    // Normalize both series
    const normalizedA = normalize(valuesA);
    const normalizedB = normalize(valuesB);
    
    let maxCorrelation = 0;
    
    // Test different lags
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const shiftedB = shiftSeries(normalizedB, lag);
      const correlation = calculateCorrelation(normalizedA, shiftedB);
      
      // Keep track of maximum absolute correlation
      if (Math.abs(correlation) > Math.abs(maxCorrelation)) {
        maxCorrelation = correlation;
      }
    }
    
    // Convert to percentage (0-100)
    return Math.abs(maxCorrelation) * 100;
  };

  useEffect(() => {
    if (!seriesA || !seriesB || seriesA.length === 0 || seriesB.length === 0) {
      return;
    }

    setIsCalculating(true);
    
    try {
      const valuesA = extractValues(seriesA);
      const valuesB = extractValues(seriesB);
      
      // Ensure both series have the same length by truncating to shorter length
      const minLength = Math.min(valuesA.length, valuesB.length);
      const truncatedA = valuesA.slice(0, minLength);
      const truncatedB = valuesB.slice(0, minLength);
      
      if (minLength < 2) {
        console.warn('Not enough data points for correlation analysis');
        setCorrelation(0);
        onCorrelationCalculated(0);
        return;
      }
      
      const correlationResult = crossCorrelationAnalysis(truncatedA, truncatedB);
      
      setCorrelation(correlationResult);
      onCorrelationCalculated(correlationResult);
    } catch (error) {
      console.error('Error calculating correlation:', error);
      setCorrelation(0);
      onCorrelationCalculated(0);
    } finally {
      setIsCalculating(false);
    }
  }, [seriesA, seriesB, maxLag, onCorrelationCalculated]);

  return (
    <div style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }}>
      <h3>Cross Correlation Analysis</h3>
      {isCalculating ? (
        <p>Calculating correlation...</p>
      ) : (
        <div>
          <p><strong>Maximum Correlation: {correlation.toFixed(2)}%</strong></p>
          <p>Series A length: {seriesA?.length || 0}</p>
          <p>Series B length: {seriesB?.length || 0}</p>
        </div>
      )}
    </div>
  );
};

export default CCA;