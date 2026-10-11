# Terminal Snake (C++)

A classic Snake game that runs in your terminal, written in C++ using
`ncurses`.

## Requirements

- A C++17 compiler (e.g. `g++`)
- The `ncurses` development library

On Debian/Ubuntu:

```bash
sudo apt install g++ libncurses-dev
```

## Build

```bash
g++ -std=c++17 -O2 -o snake snake.cpp -lncurses
```

## Run

```bash
./snake
```

## Controls

| Key               | Action                     |
| ----------------- | -------------------------- |
| Arrow keys / WASD | Move                       |
| P                 | Pause / resume             |
| R                 | Restart (after game over)  |
| Q                 | Quit                       |

## Rules

- Eat `@` to grow and gain 10 points.
- Each food makes the snake slightly faster.
- Hitting a wall or yourself ends the game.
- Best score is tracked while the game is running.
