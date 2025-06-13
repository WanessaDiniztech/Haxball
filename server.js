const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 5000;

app.use(express.static('public'));

const WIDTH = 800;
const HEIGHT = 400;
const GOAL_WIDTH = 10;
const GOAL_HEIGHT = 150;

let players = {};
let playerNames = {};
let playerColors = {};
let ball = null;
let score = { blue: 0, red: 0 };
let stats = {};
let gameRunning = false;
let startTime = 0;

function createBall() {
    return {
        x: WIDTH / 2,
        y: HEIGHT / 2,
        radius: 15,
        color: 'white',
        dx: 5 * (Math.random() < 0.5 ? 1 : -1),
        dy: (Math.random() - 0.5) * 4,
    };
}

function createBot() {
    return {
        x: WIDTH - 100,
        y: HEIGHT / 2,
        radius: 20,
        color: 'red',
        dx: 0,
        dy: 0,
        playerNum: 2,
        isBot: true,
    };
}

let bot = null;

function assignColor(num) {
    const colors = ['blue', 'red', 'yellow', 'cyan'];
    return colors[num - 1] || 'white';
}

io.on('connection', (socket) => {
    console.log('Novo jogador conectado:', socket.id);

    socket.on('setNameColor', ({ name, color }) => {
        if (!name || typeof name !== 'string' || name.trim() === '') {
            name = `Jogador${Object.keys(players).length + 1}`;
        }
        name = name.trim().substring(0, 15);
        if (!color) color = assignColor(Object.keys(players).length + 1);

        const playerNum = Object.keys(players).length + 1;
        const startX = playerNum % 2 === 1 ? 100 : WIDTH - 100;
        players[socket.id] = {
            x: startX,
            y: HEIGHT / 2,
            radius: 20,
            color,
            dx: 0,
            dy: 0,
            playerNum,
            isBot: false,
        };
        playerNames[socket.id] = name;
        playerColors[socket.id] = color;

        stats[socket.id] = { goals: 0, kicks: 0 };

        if (!gameRunning) {
            ball = createBall();
            score = { blue: 0, red: 0 };
            startTime = Date.now();
            gameRunning = true;
            gameLoop();
        }

        socket.emit('init', {
            id: socket.id,
            color,
            playerNum,
            name,
        });

        // Criar bot se só tiver 1 jogador (até 4 jogadores no total)
        if (Object.keys(players).length === 1 && !bot) {
            bot = createBot();
            players['bot'] = bot;
            playerNames['bot'] = 'BOT';
            playerColors['bot'] = 'red';
            stats['bot'] = { goals: 0, kicks: 0 };
            console.log('Bot criado');
        }

        // Se tiver jogadores suficientes, remove bot
        if (Object.keys(players).length > 1 && bot) {
            delete players['bot'];
            delete playerNames['bot'];
            delete playerColors['bot'];
            delete stats['bot'];
            bot = null;
            console.log('Bot removido');
        }
    });

    socket.on('playerMove', ({ dx, dy }) => {
        if (!players[socket.id]) return;
        players[socket.id].dx = dx;
        players[socket.id].dy = dy;
    });

    socket.on('chatMessage', (msg) => {
        if (!playerNames[socket.id]) return;

        let formattedMsg = msg
            .replace(/:\)/g, '😊')
            .replace(/:\(/g, '☹️');

        if (formattedMsg.startsWith('/help')) {
            io.to(socket.id).emit('chatMessage', { name: 'Sistema', message: 'Comandos: /help, /score' });
            return;
        }
        if (formattedMsg.startsWith('/score')) {
            io.to(socket.id).emit('chatMessage', { name: 'Sistema', message: `Placar: ${score.blue} x ${score.red}` });
            return;
        }

        io.emit('chatMessage', { name: playerNames[socket.id], message: formattedMsg });
    });

    socket.on('disconnect', () => {
        console.log('Jogador desconectou:', socket.id);
        delete players[socket.id];
        delete playerNames[socket.id];
        delete playerColors[socket.id];
        delete stats[socket.id];

        if (Object.keys(players).length === 1 && !bot) {
            bot = createBot();
            players['bot'] = bot;
            playerNames['bot'] = 'BOT';
            playerColors['bot'] = 'red';
            stats['bot'] = { goals: 0, kicks: 0 };
            console.log('Bot criado após desconexão');
        }
    });
});

function updateBot() {
    if (!bot || !ball) return;

    const speedBot = 4;

    const deltaY = ball.y - bot.y;
    if (deltaY > bot.radius + 5) bot.y += speedBot;
    else if (deltaY < -bot.radius - 5) bot.y -= speedBot;

    bot.y = Math.max(bot.radius, Math.min(HEIGHT - bot.radius, bot.y));

    const distX = ball.x - bot.x;
    const distY = ball.y - bot.y;
    const dist = Math.sqrt(distX * distX + distY * distY);
    if (dist < ball.radius + bot.radius + 10) {
        ball.dx = -7;
        ball.dy = distY * 0.3;

        if (stats['bot']) stats['bot'].kicks++;
    }
}

function updateBall() {
    ball.x += ball.dx;
    ball.y += ball.dy;

    ball.dx *= 0.995;
    ball.dy *= 0.995;

    if (ball.y - ball.radius < 0 || ball.y + ball.radius > HEIGHT) {
        ball.dy = -ball.dy;
    }

    for (const id in players) {
        const p = players[id];
        let distX = ball.x - p.x;
        let distY = ball.y - p.y;
        let dist = Math.sqrt(distX * distX + distY * distY);
        if (dist < ball.radius + p.radius) {
            let angle = Math.atan2(distY, distX);
            let speed = Math.sqrt(ball.dx * ball.dx + ball.dy * ball.dy) || 5;
            ball.dx = speed * Math.cos(angle);
            ball.dy = speed * Math.sin(angle);

            ball.x = p.x + (ball.radius + p.radius) * Math.cos(angle);
            ball.y = p.y + (ball.radius + p.radius) * Math.sin(angle);

            if (!p.isBot && stats[id]) stats[id].kicks++;
        }
    }

    // Gol Azul
    if (
        ball.x - ball.radius < GOAL_WIDTH &&
        ball.y > (HEIGHT - GOAL_HEIGHT) / 2 &&
        ball.y < (HEIGHT + GOAL_HEIGHT) / 2
    ) {
        score.red++;
        if (stats['bot']) stats['bot'].goals++;
        resetRound();
    }

    // Gol Vermelho
    if (
        ball.x + ball.radius > WIDTH - GOAL_WIDTH &&
        ball.y > (HEIGHT - GOAL_HEIGHT) / 2 &&
        ball.y < (HEIGHT + GOAL_HEIGHT) / 2
    ) {
        score.blue++;
        resetRound();
    }
}

function resetRound() {
    ball = createBall();
    for (const id in players) {
        let p = players[id];
        p.x = p.playerNum % 2 === 1 ? 100 : WIDTH - 100;
        p.y = HEIGHT / 2;
        p.dx = 0;
        p.dy = 0;
    }
}

function gameLoop() {
    if (!gameRunning) return;

    for (const id in players) {
        if (players[id].isBot) continue;

        const p = players[id];
        p.x += p.dx;
        p.y += p.dy;

        p.x = Math.max(p.radius, Math.min(WIDTH - p.radius, p.x));
        p.y = Math.max(p.radius, Math.min(HEIGHT - p.radius, p.y));
    }

    updateBot();
    updateBall();

    io.emit('gameState', { players, ball, score, stats, elapsedTime: Date.now() - startTime });

    setTimeout(gameLoop, 1000 / 60);
}

http.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

