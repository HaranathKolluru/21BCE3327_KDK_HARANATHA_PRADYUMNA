const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = socketIo(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

let gameStatus = {
  grid: Array(5).fill().map(() => Array(5).fill(null)),
  activePlayer: 'A',
  participants: {},
  actionLog: []
};

const unitTypes = {
  'P': { label: 'Soldier', directions: ['F', 'B', 'L', 'R', 'FL', 'FR', 'BL', 'BR'], maxSteps: 1 },
  'H1': { label: 'Warrior1', directions: ['F', 'B', 'L', 'R'], maxSteps: 2 },
  'H2': { label: 'Warrior2', directions: ['FL', 'FR', 'BL', 'BR'], maxSteps: 2 },
  'H3': { label: 'Warrior3', directions: ['FL', 'FR', 'BL', 'BR', 'RF', 'RB', 'LF', 'LB'], maxSteps: 3 }
};

function resetGame() {
  gameStatus.grid = [
    ['A-S1', 'A-W1', 'A-W2', 'A-W3', 'A-S2'],
    [null, null, null, null, null],
    [null, null, null, null, null],
    [null, null, null, null, null],
    ['B-S1', 'B-W1', 'B-W2', 'B-W3', 'B-S2']
  ];
  gameStatus.activePlayer = 'A';
  gameStatus.actionLog = [];
}

function validateMove(player, startX, startY, endX, endY) {
  const unit = gameStatus.grid[startY][startX];
  if (!unit || unit[0] !== player) return false;
  
  const [, unitCategory] = unit.split('-');
  const unitSpec = unitTypes[unitCategory.slice(0, 2)];
  
  if (!unitSpec) return false;
  
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  
  if (endX < 0 || endX > 4 || endY < 0 || endY > 4) return false;

  if (gameStatus.grid[endY][endX] && gameStatus.grid[endY][endX][0] === player) return false;

  return Math.abs(deltaX) <= unitSpec.maxSteps && Math.abs(deltaY) <= unitSpec.maxSteps && (deltaX !== 0 || deltaY !== 0);
}

function applyMove(player, startX, startY, endX, endY) {
  const unit = gameStatus.grid[startY][startX];
  const targetUnit = gameStatus.grid[endY][endX];
  
  gameStatus.grid[endY][endX] = unit;
  gameStatus.grid[startY][startX] = null;
  
  const actionDetail = `${unit}: (${startX},${startY}) to (${endX},${endY})${targetUnit ? ` capturing ${targetUnit}` : ''}`;
  gameStatus.actionLog.push(actionDetail);
  
  gameStatus.activePlayer = gameStatus.activePlayer === 'A' ? 'B' : 'A';
  return true;
}

function determineWinner() {
  const aWarriors = gameStatus.grid.flat().filter(cell => cell && cell.startsWith('A-W')).length;
  const bWarriors = gameStatus.grid.flat().filter(cell => cell && cell.startsWith('B-W')).length;
  if (aWarriors === 0) return 'B';
  if (bWarriors === 0) return 'A';
  if (gameStatus.actionLog.length >= 100) return 'draw';
  return null;
}

io.on('connection', (socket) => {
  console.log('New participant connected');
  
  socket.on('joinMatch', (player) => {
    if (!gameStatus.participants[player]) {
      gameStatus.participants[player] = socket.id;
      socket.emit('playerConfirmed', player);
      
      if (Object.keys(gameStatus.participants).length === 2) {
        resetGame();
        io.emit('matchStart', gameStatus);
      }
    } else {
      socket.emit('statusUpdate', gameStatus);
    }
  });
  
  socket.on('action', ({ player, startX, startY, endX, endY }) => {
    if (player === gameStatus.activePlayer && validateMove(player, startX, startY, endX, endY)) {
      applyMove(player, startX, startY, endX, endY);
      io.emit('statusUpdate', gameStatus);
      
      const outcome = determineWinner();
      if (outcome) {
        io.emit('matchEnd', { outcome });
      }
    } else {
      socket.emit('moveRejected');
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Participant disconnected');
    Object.keys(gameStatus.participants).forEach(player => {
      if (gameStatus.participants[player] === socket.id) {
        delete gameStatus.participants[player];
      }
    });
    if (Object.keys(gameStatus.participants).length < 2) {
      gameStatus = {
        grid: Array(5).fill().map(() => Array(5).fill(null)),
        activePlayer: 'A',
        participants: {},
        actionLog: []
      };
      io.emit('matchReset');
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server active on port ${PORT}`));
