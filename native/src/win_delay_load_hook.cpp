// Redirige l'import differe "node.exe" (node.lib) vers l'executable qui heberge l'addon, ici
// electron.exe. Meme principe que le crochet fourni par node-gyp (win_delay_load_hook.cc).
#ifdef _WIN32
#include <windows.h>
#include <delayimp.h>
#include <string.h>

namespace {
FARPROC WINAPI redirect_node_exe(unsigned int event, DelayLoadInfo* info) {
  if (event != dliNotePreLoadLibrary) return nullptr;
  if (_stricmp(info->szDll, "node.exe") != 0) return nullptr;
  return reinterpret_cast<FARPROC>(GetModuleHandle(nullptr));
}
}  // namespace

extern "C" {
const PfnDliHook __pfnDliNotifyHook2 = redirect_node_exe;
}
#endif
