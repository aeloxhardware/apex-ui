#pragma once
// Boucle parallele minimale (sans dependance) : decoupe [0, count) en tranches contigues, une par
// fil. Aucune reduction : chaque iteration ecrit dans sa propre case, le resultat ne depend donc
// pas du nombre de fils (meme discipline que l'oracle du moteur).
#include <algorithm>
#include <cstddef>
#include <thread>
#include <vector>

namespace apex::edit {

template <class Fn>
void parallel_for(size_t count, unsigned threads, size_t min_per_thread, Fn&& fn) {
  if (threads <= 1 || count < 2 * min_per_thread) {
    fn(size_t{0}, count);
    return;
  }
  const size_t workers = std::min<size_t>(threads, count / min_per_thread);
  const size_t chunk = (count + workers - 1) / workers;
  std::vector<std::thread> pool;
  pool.reserve(workers - 1);
  for (size_t w = 1; w < workers; ++w) {
    const size_t begin = w * chunk;
    const size_t end = std::min(count, begin + chunk);
    if (begin >= end) break;
    pool.emplace_back([&fn, begin, end] { fn(begin, end); });
  }
  fn(size_t{0}, std::min(count, chunk));
  for (auto& thread : pool) thread.join();
}

}  // namespace apex::edit
