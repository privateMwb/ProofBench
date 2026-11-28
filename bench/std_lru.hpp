// The "textbook" LRU used as the comparison baseline by both the benchmark and the
// verification modules: std::list for recency order + std::unordered_map for lookup.
// reserve() is called up front so it never rehashes (the baseline's best case).
#pragma once

#include <cstddef>
#include <list>
#include <unordered_map>
#include <utility>

class StdLRU {
    using Item = std::pair<int, int>;
    std::size_t cap_;
    std::list<Item> items_;
    std::unordered_map<int, std::list<Item>::iterator> index_;

  public:
    explicit StdLRU(std::size_t cap) : cap_(cap) { index_.reserve(cap); }

    int* get(int key) {
        auto it = index_.find(key);
        if (it == index_.end()) return nullptr;
        items_.splice(items_.begin(), items_, it->second);
        return &it->second->second;
    }

    void put(int key, int value) {
        auto it = index_.find(key);
        if (it != index_.end()) {
            it->second->second = value;
            items_.splice(items_.begin(), items_, it->second);
            return;
        }
        if (items_.size() == cap_) {
            index_.erase(items_.back().first);
            items_.pop_back();
        }
        items_.emplace_front(key, value);
        index_[key] = items_.begin();
    }

    bool erase(int key) {
        auto it = index_.find(key);
        if (it == index_.end()) return false;
        items_.erase(it->second);
        index_.erase(it);
        return true;
    }

    std::size_t size() const { return items_.size(); }
};
