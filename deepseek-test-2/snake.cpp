// Terminal Snake Game (C++)
// Build: g++ -std=c++17 -O2 -o snake snake.cpp -lncurses
// Run:   ./snake
// Controls: Arrows/WASD move, P pause, R restart, Q quit

#include <ncurses.h>
#include <deque>
#include <vector>
#include <random>
#include <chrono>
#include <string>
#include <algorithm>

struct Point {
    int y, x;
    bool operator==(const Point& o) const { return y == o.y && x == o.x; }
};

enum class Dir { Up, Down, Left, Right };

class SnakeGame {
public:
    SnakeGame() {
        initscr();
        cbreak();
        noecho();
        curs_set(0);
        nodelay(stdscr, TRUE);
        keypad(stdscr, TRUE);
        if (has_colors()) {
            start_color();
            use_default_colors();
            init_pair(1, COLOR_BLUE, -1);
            init_pair(2, COLOR_CYAN, -1);
            init_pair(3, COLOR_RED, -1);
            init_pair(4, COLOR_GREEN, -1);
            init_pair(5, COLOR_YELLOW, -1);
        }
        getmaxyx(stdscr, height_, width_);
        playTop_ = 2;
        playBottom_ = height_ - 2;
        playLeft_ = 1;
        playRight_ = width_ - 2;
        rng_.seed(std::chrono::steady_clock::now().time_since_epoch().count());
        reset();
    }
    ~SnakeGame() { endwin(); }

    void run() {
        auto last = std::chrono::steady_clock::now();
        bool running = true;
        while (running) {
            if (!handleInput(running)) break;
            auto now = std::chrono::steady_clock::now();
            double elapsed = std::chrono::duration<double>(now - last).count();
            if (!paused_ && !gameOver_) {
                if (elapsed >= speed_) { step(); last = now; }
            } else {
                last = now;
            }
            draw();
            napms(10);
        }
    }

private:
    int height_ = 0, width_ = 0;
    int playTop_ = 0, playBottom_ = 0, playLeft_ = 0, playRight_ = 0;
    std::deque<Point> snake_;
    Dir dir_ = Dir::Right;
    Dir pendingDir_ = Dir::Right;
    Point food_{0, 0};
    bool hasFood_ = false;
    int score_ = 0;
    int best_ = 0;
    bool gameOver_ = false;
    bool paused_ = false;
    double speed_ = 0.12;
    std::mt19937 rng_;

    void reset() {
        int midY = (playTop_ + playBottom_) / 2;
        int midX = (playLeft_ + playRight_) / 2;
        snake_.clear();
        snake_.push_back({midY, midX});
        snake_.push_back({midY, midX - 1});
        snake_.push_back({midY, midX - 2});
        dir_ = Dir::Right;
        pendingDir_ = Dir::Right;
        score_ = 0;
        gameOver_ = false;
        paused_ = false;
        speed_ = 0.12;
        spawnFood();
    }

    bool occupied(const Point& p) const {
        for (const auto& s : snake_) if (s == p) return true;
        return false;
    }

    void spawnFood() {
        std::vector<Point> empty;
        for (int y = playTop_; y <= playBottom_; ++y)
            for (int x = playLeft_; x <= playRight_; ++x) {
                Point p{y, x};
                if (!occupied(p)) empty.push_back(p);
            }
        if (empty.empty()) { hasFood_ = false; return; }
        std::uniform_int_distribution<size_t> dist(0, empty.size() - 1);
        food_ = empty[dist(rng_)];
        hasFood_ = true;
    }

    bool handleInput(bool& running) {
        int ch;
        while ((ch = getch()) != ERR) {
            if (ch == 'q' || ch == 'Q') { running = false; return false; }
            if ((ch == 'p' || ch == 'P') && !gameOver_) paused_ = !paused_;
            if ((ch == 'r' || ch == 'R') && gameOver_) reset();
            Dir nd; bool valid = true;
            switch (ch) {
                case KEY_UP: case 'w': case 'W': nd = Dir::Up; break;
                case KEY_DOWN: case 's': case 'S': nd = Dir::Down; break;
                case KEY_LEFT: case 'a': case 'A': nd = Dir::Left; break;
                case KEY_RIGHT: case 'd': case 'D': nd = Dir::Right; break;
                default: valid = false; break;
            }
            if (valid && !isOpposite(nd, dir_)) pendingDir_ = nd;
        }
        return true;
    }

    static bool isOpposite(Dir a, Dir b) {
        return (a == Dir::Up && b == Dir::Down) || (a == Dir::Down && b == Dir::Up) ||
               (a == Dir::Left && b == Dir::Right) || (a == Dir::Right && b == Dir::Left);
    }

    void step() {
        dir_ = pendingDir_;
        Point head = snake_.front();
        switch (dir_) {
            case Dir::Up: head.y -= 1; break;
            case Dir::Down: head.y += 1; break;
            case Dir::Left: head.x -= 1; break;
            case Dir::Right: head.x += 1; break;
        }
        if (head.y < playTop_ || head.y > playBottom_ || head.x < playLeft_ || head.x > playRight_) {
            endGame(); return;
        }
        for (size_t i = 0; i + 1 < snake_.size(); ++i)
            if (snake_[i] == head) { endGame(); return; }
        snake_.push_front(head);
        if (hasFood_ && head == food_) {
            score_ += 10;
            best_ = std::max(best_, score_);
            spawnFood();
            speed_ = std::max(0.05, speed_ - 0.003);
        } else {
            snake_.pop_back();
        }
    }

    void endGame() { gameOver_ = true; best_ = std::max(best_, score_); }

    void drawBorder() {
        attron(COLOR_PAIR(1));
        for (int x = playLeft_ - 1; x <= playRight_ + 1; ++x) {
            mvaddch(playTop_ - 1, x, '#');
            mvaddch(playBottom_ + 1, x, '#');
        }
        for (int y = playTop_ - 1; y <= playBottom_ + 1; ++y) {
            mvaddch(y, playLeft_ - 1, '#');
            mvaddch(y, playRight_ + 1, '#');
        }
        attroff(COLOR_PAIR(1));
    }

    void drawHud() {
        std::string title = " TERMINAL SNAKE ";
        std::string hud = " Score: " + std::to_string(score_) + "  Best: " + std::to_string(best_) + " ";
        attron(COLOR_PAIR(2) | A_BOLD);
        mvaddstr(0, std::max(0, (width_ - (int)title.size()) / 2), title.c_str());
        attroff(COLOR_PAIR(2) | A_BOLD);
        mvaddnstr(1, 0, hud.c_str(), width_ - 1);
        std::string hint = " WASD/Arrows: move  P: pause  Q: quit ";
        if (width_ > (int)(hud.size() + hint.size()) + 2)
            mvaddstr(1, width_ - (int)hint.size() - 1, hint.c_str());
    }

    void centerMsg(const std::string& text, int rowOffset) {
        int y = height_ / 2 + rowOffset;
        int x = std::max(0, (width_ - (int)text.size()) / 2);
        attron(COLOR_PAIR(5) | A_BOLD);
        mvaddnstr(y, x, text.c_str(), width_ - 1);
        attroff(COLOR_PAIR(5) | A_BOLD);
    }

    void draw() {
        erase();
        drawBorder();
        drawHud();
        if (hasFood_) {
            attron(COLOR_PAIR(3) | A_BOLD);
            mvaddch(food_.y, food_.x, '@');
            attroff(COLOR_PAIR(3) | A_BOLD);
        }
        bool first = true;
        for (const auto& s : snake_) {
            attron(COLOR_PAIR(4) | (first ? A_BOLD : 0));
            mvaddch(s.y, s.x, first ? 'O' : 'o');
            attroff(COLOR_PAIR(4) | (first ? A_BOLD : 0));
            first = false;
        }
        if (paused_ && !gameOver_) centerMsg(" PAUSED ", 2);
        if (gameOver_) {
            centerMsg(" GAME OVER ", 2);
            centerMsg("Press R to restart, Q to quit", 3);
        }
        refresh();
    }
};

int main() {
    SnakeGame game;
    game.run();
    return 0;
}
