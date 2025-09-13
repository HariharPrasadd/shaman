import React from 'react';
import type { PolymarketEvent } from '../types/polymarket';

interface MarketDisplayProps {
  event: PolymarketEvent;
}

const MarketDisplay: React.FC<MarketDisplayProps> = ({ event }) => {
  const parseClobIds = (clobTokenIds: string): string[] => {
    try {
      return JSON.parse(clobTokenIds);
    } catch {
      return [];
    }
  };

  const parseOutcomes = (outcomes: string): string[] => {
    try {
      return JSON.parse(outcomes);
    } catch {
      return [];
    }
  };

  const parseOutcomePrices = (outcomePrices: string): number[] => {
    try {
      return JSON.parse(outcomePrices).map((price: string) => parseFloat(price));
    } catch {
      return [];
    }
  };

  const formatPrice = (price: number): string => {
    return (price * 100).toFixed(2) + '%';
  };

  return (
    <div className="mt-8 space-y-6">
      {/* Event Header */}
      <div className="bg-gray-900/50 backdrop-blur-sm rounded-lg p-6 border border-gray-800">
        <div className="flex items-start gap-4">
          <img
            src={event.image}
            alt={event.title}
            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/vite.svg';
            }}
          />
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white mb-2">{event.title}</h2>
            <p className="text-gray-300 text-sm mb-4 line-clamp-3">{event.description}</p>
            <div className="flex flex-wrap gap-4 text-sm text-gray-400">
              <span>Category: {event.category}</span>
              <span>Volume: ${event.volume.toLocaleString()}</span>
              <span>Liquidity: ${event.liquidity.toLocaleString()}</span>
              <span>Markets: {event.markets.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Markets Grid */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-white mb-4">
          Markets ({event.markets.length})
        </h3>
        
        {event.markets.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            No markets available for this event.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {event.markets.map((market) => {
              const clobIds = parseClobIds(market.clobTokenIds);
              const outcomes = parseOutcomes(market.outcomes);
              const prices = parseOutcomePrices(market.outcomePrices);

              return (
                <div
                  key={market.id}
                  className="bg-gray-900/50 backdrop-blur-sm rounded-lg p-4 border border-gray-800 hover:border-gray-700 transition-colors"
                >
                  <div className="space-y-3">
                    {/* Market Question */}
                    <h4 className="text-white font-medium text-sm line-clamp-2">
                      {market.question}
                    </h4>

                    {/* Market Image */}
                    {market.image && (
                      <img
                        src={market.image}
                        alt={market.question}
                        className="w-full h-24 object-cover rounded-lg"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/vite.svg';
                        }}
                      />
                    )}

                    {/* Outcomes and Prices */}
                    <div className="space-y-2">
                      {outcomes.map((outcome, index) => (
                        <div
                          key={outcome}
                          className="flex justify-between items-center bg-gray-800/50 rounded px-3 py-2"
                        >
                          <span className="text-gray-300 text-sm">{outcome}</span>
                          <span className="text-white font-mono text-sm">
                            {formatPrice(prices[index] || 0)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Market Stats */}
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                      <div>
                        <span className="block">Volume</span>
                        <span className="text-white">${parseFloat(market.volume).toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="block">Liquidity</span>
                        <span className="text-white">${parseFloat(market.liquidity).toLocaleString()}</span>
                      </div>
                    </div>

                    {/* CLOB IDs */}
                    <div className="space-y-2">
                      <div className="text-xs text-gray-400 font-medium">CLOB Token IDs:</div>
                      <div className="space-y-1">
                        {clobIds.map((clobId, index) => (
                          <div
                            key={index}
                            className="bg-gray-800/30 rounded px-2 py-1 text-xs font-mono text-gray-300 break-all"
                          >
                            {clobId}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Market Status */}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-800">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            market.active ? 'bg-green-500' : 'bg-red-500'
                          }`}
                        />
                        <span className="text-xs text-gray-400">
                          {market.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400">
                        {market.closed ? 'Closed' : 'Open'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MarketDisplay;
