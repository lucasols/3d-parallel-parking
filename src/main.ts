import './style.css';
import { Game } from './game';

declare global {
  interface Window {
    parkingDebug?: Game;
  }
}

const container = document.getElementById('viewport');
if (!container) throw new Error('Missing #viewport');

// Let the loading screen paint before the (synchronous) texture generation starts.
setTimeout(() => {
  const game = new Game(container);
  if (import.meta.env.MODE === 'development') window.parkingDebug = game;
}, 50);
