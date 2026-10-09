// Verre liquide natif qui refracte le bureau Windows DERRIERE une fenetre Electron.
//
// Pourquoi natif : dessiner le verre dans la page (capture -> copie CPU -> IPC -> WebGL -> compositeur)
// ajoutait plusieurs images de retard pendant un deplacement de la fenetre. Ici tout reste dans ce processus,
// et sur le GPU de bout en bout :
//  - un thread capture le bureau (DXGI Desktop Duplication) vers une texture GPU ;
//  - une fenetre native (sans clic, sans activation) est placee SOUS la fenetre Electron (elle en devient la
//    proprietaire : Windows garde toujours une fenetre possedee au-dessus) ;
//  - le verre est un pixel shader HLSL (D3D11) qui lit cette texture a la position COURANTE de la fenetre et
//    ecrit dans une chaine d'echange DirectComposition (alpha premultiplie) : AUCUNE copie GPU -> CPU. Un
//    premier essai (lecture CPU + UpdateLayeredWindow) coutait 9 a 11 ms par rendu sur le thread de
//    l'interface, soit un glissement saccade de ~30 ms par position ;
//  - le dessin est refait quand la fenetre bouge (WM_WINDOWPOSCHANGED, fenetre Electron sous-classee) et quand
//    les pixels derriere elle changent, SANS jamais bloquer : l'attente d'une image libre est testee a
//    temps nul, sinon on reessaie 2 ms plus tard.
// La page ne dessine que le texte, par-dessus, sur fond transparent.
//
// Le shader (src/backdrop.hlsl, compile a la construction par fxc) est le « Liquid Glass Studio » de Charles Yin
// (MIT, https://github.com/iyinchao/liquid-glass-studio), deja utilise par le verre WebGL de l'application
// (src/components/edit-node/liquidGlass.ts), porte ici en HLSL :
// reflexion de Snell avec dispersion chromatique, liseré de Fresnel, reflet directionnel en espace LCH,
// centre NET et flou de 7 px seulement dans la bande du biseau (le verre des panneaux « Accueil », warp 4, floute tout), sans teinte.
// Les conversions de couleur viennent de GLSL-Color-Functions (Rachmanin0xFF, MIT).
//
// Les deux fenetres sont exclues de la capture (WDA_EXCLUDEFROMCAPTURE, Windows 10 2004+), sinon le verre se
// capturerait lui-meme.
//
//   start(hwnd: Buffer, { corner, tint, warp, blur }, onReady?) -> true | false   hwnd = win.getNativeWindowHandle() ;
//                                                   onReady() : appele une fois, au premier verre affiche
//   stop()
#include <node_api.h>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <commctrl.h>
#include <d3d11_4.h>
#include <dcomp.h>
#include <dxgi1_3.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;

// Bytecode des shaders, genere par fxc depuis src/backdrop.hlsl (CMakeLists.txt).
#include "backdrop_vs.h"
#include "backdrop_psBlurH.h"
#include "backdrop_psBlurV.h"
#include "backdrop_psMain.h"

namespace {

constexpr UINT WM_APEX_RENDER = WM_APP + 41;
constexpr UINT_PTR kSubclassId = 0xA9E8;
constexpr UINT_PTR kRetryTimer = 1;
#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011
#endif

struct Cb {
  float winPos[2], size[2], texSize[2], blurSize[2];
  float margin, corner, scale, radius;
  float sigma, tint, shadowPad, pad;
};

struct Target {
  ComPtr<ID3D11Texture2D> tex;
  ComPtr<ID3D11RenderTargetView> rtv;
  ComPtr<ID3D11ShaderResourceView> srv;
};

class Glass {
 public:
  Glass(HWND owner, float corner, float tint, float warp, float blur, napi_threadsafe_function on_ready)
      : owner_(owner), corner_(corner), tint_(tint), warp_(warp), blur_(blur), on_ready_(on_ready) {}
  ~Glass() { shutdown(); }

  void set_taskbar(bool value) { taskbar_ = value; }
  // Verre « retenu » : tout est prepare et dessine mais la fenetre de verre reste cachee jusqu'a release().
  void set_hold(bool value) { hold_ = value; }
  void release() {
    hold_ = false;
    render();
  }

  bool start() {
    if (!create_window()) return false;
    // Peripherique D3D et duplication du bureau : crees dans le thread de capture (plusieurs dizaines de ms),
    // jamais ici, sur le thread de l'interface.
    // Sous-classe la fenetre Electron : le verre est redessine dans le meme message que son deplacement.
    SetWindowSubclass(owner_, &Glass::subclass_proc, kSubclassId, reinterpret_cast<DWORD_PTR>(this));
    subclassed_ = true;
    // La fenetre Electron devient possedee par le verre : Windows la garde TOUJOURS au-dessus de lui.
    SetWindowLongPtrW(owner_, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR>(glass_));
    // Possedee par le verre, la fenetre Electron n'aurait ni bouton de barre des taches ni entree Alt+Tab (Windows ne
    // les donne qu'aux fenetres non possedees) : WS_EX_APPWINDOW les lui rend. Il faut la masquer puis la remontrer
    // pour que le shell prenne le style en compte.
    if (taskbar_) {
      const LONG_PTR ex = GetWindowLongPtrW(owner_, GWL_EXSTYLE);
      SetWindowLongPtrW(owner_, GWL_EXSTYLE, (ex | WS_EX_APPWINDOW) & ~static_cast<LONG_PTR>(WS_EX_TOOLWINDOW));
      if (IsWindowVisible(owner_)) {
        ShowWindow(owner_, SW_HIDE);
        ShowWindow(owner_, SW_SHOWNA);
      }
    }
    thread_ = std::thread([this] { capture_loop(); });
    return true;
  }

  void shutdown() {
    if (down_.exchange(true)) return;
    stopped_ = true;
    if (thread_.joinable()) thread_.join();
    if (owner_ && IsWindow(owner_)) {
      if (subclassed_) RemoveWindowSubclass(owner_, &Glass::subclass_proc, kSubclassId);
      SetWindowLongPtrW(owner_, GWLP_HWNDPARENT, 0);  // sinon DestroyWindow(glass_) emporterait la fenetre possedee
    }
    subclassed_ = false;
    dc_target_.Reset();
    dc_visual_.Reset();
    dc_device_.Reset();
    swapchain_.Reset();
    if (glass_) { DestroyWindow(glass_); glass_ = nullptr; }
    if (on_ready_) { napi_release_threadsafe_function(on_ready_, napi_tsfn_release); on_ready_ = nullptr; }
  }

 private:
  static LRESULT CALLBACK subclass_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp, UINT_PTR id, DWORD_PTR ref) {
    auto* self = reinterpret_cast<Glass*>(ref);
    if (msg == WM_NCDESTROY) {
      self->stopped_ = true;
      RemoveWindowSubclass(hwnd, &Glass::subclass_proc, id);
      self->subclassed_ = false;
      return DefSubclassProc(hwnd, msg, wp, lp);
    }
    LRESULT result = DefSubclassProc(hwnd, msg, wp, lp);
    if (msg == WM_WINDOWPOSCHANGED || msg == WM_SHOWWINDOW || msg == WM_DPICHANGED) self->render();
    return result;
  }

  static LRESULT CALLBACK glass_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_APEX_RENDER || msg == WM_TIMER) {
      auto* self = reinterpret_cast<Glass*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
      if (msg == WM_TIMER) KillTimer(hwnd, kRetryTimer);
      if (self) self->render();
      return 0;
    }
    if (msg == WM_NCHITTEST) return HTTRANSPARENT;
    if (msg == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
    return DefWindowProcW(hwnd, msg, wp, lp);
  }

  bool create_window() {
    static bool registered = false;
    if (!registered) {
      WNDCLASSEXW wc = {sizeof(wc)};
      wc.lpfnWndProc = &Glass::glass_proc;
      wc.hInstance = GetModuleHandleW(nullptr);
      wc.lpszClassName = L"ApexBackdropGlass";
      if (!RegisterClassExW(&wc)) return false;
      registered = true;
    }
    // NOREDIRECTIONBITMAP : le contenu vient uniquement de la visuelle DirectComposition (chaine d'echange alpha).
    glass_ = CreateWindowExW(WS_EX_NOREDIRECTIONBITMAP | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW |
                                 WS_EX_TOPMOST,
                             L"ApexBackdropGlass", L"", WS_POPUP, 0, 0, 1, 1, nullptr, nullptr, GetModuleHandleW(nullptr),
                             nullptr);
    if (!glass_) return false;
    SetWindowLongPtrW(glass_, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));
    SetWindowDisplayAffinity(glass_, WDA_EXCLUDEFROMCAPTURE);
    return true;
  }

  bool create_device() {
    D3D_FEATURE_LEVEL level;
    if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0,
                                 D3D11_SDK_VERSION, &device_, &level, &ctx_))) {
      return false;
    }
    ComPtr<ID3D11Multithread> mt;
    if (SUCCEEDED(ctx_.As(&mt))) mt->SetMultithreadProtected(TRUE);
    if (FAILED(device_->CreateVertexShader(kBackdrop_vs, sizeof(kBackdrop_vs), nullptr, &vs_)) ||
        FAILED(device_->CreatePixelShader(kBackdrop_psBlurH, sizeof(kBackdrop_psBlurH), nullptr, &ps_blur_h_)) ||
        FAILED(device_->CreatePixelShader(kBackdrop_psBlurV, sizeof(kBackdrop_psBlurV), nullptr, &ps_blur_v_)) ||
        FAILED(device_->CreatePixelShader(kBackdrop_psMain, sizeof(kBackdrop_psMain), nullptr, &ps_main_))) {
      return false;
    }
    D3D11_BUFFER_DESC bd = {};
    bd.ByteWidth = sizeof(Cb);
    bd.Usage = D3D11_USAGE_DEFAULT;
    bd.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    if (FAILED(device_->CreateBuffer(&bd, nullptr, &cb_))) return false;
    D3D11_SAMPLER_DESC sd = {};
    sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    return SUCCEEDED(device_->CreateSamplerState(&sd, &sampler_));
  }

  // Duplication de TOUTES les sorties du GPU, copiees dans une seule texture qui couvre le bureau virtuel :
  // une fenetre a cheval sur deux ecrans voit le bureau des deux cotes.
  bool open_output() {
    std::lock_guard<std::mutex> lock(gpu_);
    dups_.clear();
    desktop_copy_.Reset();
    desktop_srv_.Reset();
    have_desktop_ = false;
    ComPtr<IDXGIDevice> dxgi_device;
    ComPtr<IDXGIAdapter> adapter;
    if (FAILED(device_.As(&dxgi_device)) || FAILED(dxgi_device->GetAdapter(&adapter))) return false;
    RECT all = {0, 0, 0, 0};
    for (UINT i = 0;; ++i) {
      ComPtr<IDXGIOutput> output;
      if (adapter->EnumOutputs(i, &output) == DXGI_ERROR_NOT_FOUND) break;
      DXGI_OUTPUT_DESC desc;
      if (FAILED(output->GetDesc(&desc)) || !desc.AttachedToDesktop) continue;
      ComPtr<IDXGIOutput1> output1;
      Dup d;
      if (FAILED(output.As(&output1)) || FAILED(output1->DuplicateOutput(device_.Get(), &d.dup))) continue;
      d.rc = desc.DesktopCoordinates;
      if (dups_.empty()) {
        all = d.rc;
      } else {
        all.left = std::min(all.left, d.rc.left);
        all.top = std::min(all.top, d.rc.top);
        all.right = std::max(all.right, d.rc.right);
        all.bottom = std::max(all.bottom, d.rc.bottom);
      }
      dups_.push_back(std::move(d));
    }
    if (dups_.empty()) return false;
    origin_x_ = all.left;
    origin_y_ = all.top;
    out_w_ = all.right - all.left;
    out_h_ = all.bottom - all.top;
    D3D11_TEXTURE2D_DESC td = {};
    td.Width = static_cast<UINT>(out_w_);
    td.Height = static_cast<UINT>(out_h_);
    td.MipLevels = 1;
    td.ArraySize = 1;
    td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_DEFAULT;
    td.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    if (FAILED(device_->CreateTexture2D(&td, nullptr, &desktop_copy_))) return false;
    return SUCCEEDED(device_->CreateShaderResourceView(desktop_copy_.Get(), nullptr, &desktop_srv_));
  }

  bool make_target(Target* t, int w, int h) {
    D3D11_TEXTURE2D_DESC td = {};
    td.Width = static_cast<UINT>(w);
    td.Height = static_cast<UINT>(h);
    td.MipLevels = 1;
    td.ArraySize = 1;
    td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_DEFAULT;
    td.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    return SUCCEEDED(device_->CreateTexture2D(&td, nullptr, &t->tex)) &&
           SUCCEEDED(device_->CreateRenderTargetView(t->tex.Get(), nullptr, &t->rtv)) &&
           SUCCEEDED(device_->CreateShaderResourceView(t->tex.Get(), nullptr, &t->srv));
  }

  bool ensure_blur_targets(int bw, int bh) {
    if (tmp_.tex && blur_w_ == bw && blur_h_ == bh) return true;
    tmp_ = Target();
    blur_tex_ = Target();
    if (!make_target(&tmp_, bw, bh) || !make_target(&blur_tex_, bw, bh)) return false;
    blur_w_ = bw;
    blur_h_ = bh;
    return true;
  }

  // Chaine d'echange de composition (alpha premultiplie) + visuelle DirectComposition liee a la fenetre de
  // verre. Creee ici, sur le thread de l'interface (proprietaire de la fenetre).
  bool ensure_swapchain(int w, int h) {
    static constexpr UINT kFlags = DXGI_SWAP_CHAIN_FLAG_FRAME_LATENCY_WAITABLE_OBJECT;
    if (swapchain_) {
      if (sc_w_ == w && sc_h_ == h) return true;
      if (FAILED(swapchain_->ResizeBuffers(0, static_cast<UINT>(w), static_cast<UINT>(h), DXGI_FORMAT_UNKNOWN, kFlags))) {
        return false;
      }
      sc_w_ = w;
      sc_h_ = h;
      return true;
    }
    ComPtr<IDXGIDevice> dxgi_device;
    ComPtr<IDXGIAdapter> adapter;
    ComPtr<IDXGIFactory2> factory;
    if (FAILED(device_.As(&dxgi_device)) || FAILED(dxgi_device->GetAdapter(&adapter)) ||
        FAILED(adapter->GetParent(IID_PPV_ARGS(&factory)))) {
      return false;
    }
    DXGI_SWAP_CHAIN_DESC1 desc = {};
    desc.Width = static_cast<UINT>(w);
    desc.Height = static_cast<UINT>(h);
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    desc.BufferCount = 2;
    desc.Scaling = DXGI_SCALING_STRETCH;
    desc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;
    desc.AlphaMode = DXGI_ALPHA_MODE_PREMULTIPLIED;
    desc.Flags = kFlags;
    ComPtr<IDXGISwapChain1> sc1;
    if (FAILED(factory->CreateSwapChainForComposition(device_.Get(), &desc, nullptr, &sc1)) ||
        FAILED(sc1.As(&swapchain_))) {
      return false;
    }
    // Une seule image en attente : jamais plus d'une image d'avance sur l'affichage.
    swapchain_->SetMaximumFrameLatency(1);
    waitable_ = swapchain_->GetFrameLatencyWaitableObject();
    if (FAILED(DCompositionCreateDevice(dxgi_device.Get(), IID_PPV_ARGS(&dc_device_))) ||
        FAILED(dc_device_->CreateTargetForHwnd(glass_, TRUE, &dc_target_)) || FAILED(dc_device_->CreateVisual(&dc_visual_)) ||
        FAILED(dc_visual_->SetContent(swapchain_.Get())) || FAILED(dc_target_->SetRoot(dc_visual_.Get())) ||
        FAILED(dc_device_->Commit())) {
      swapchain_.Reset();
      return false;
    }
    sc_w_ = w;
    sc_h_ = h;
    return true;
  }

  void draw_pass(ID3D11RenderTargetView* target, int w, int h, ID3D11PixelShader* ps, ID3D11ShaderResourceView* input,
                 ID3D11ShaderResourceView* input2 = nullptr, ID3D11ShaderResourceView* input3 = nullptr) {
    ID3D11RenderTargetView* rtvs[] = {target};
    ctx_->OMSetRenderTargets(1, rtvs, nullptr);
    D3D11_VIEWPORT vp = {0, 0, static_cast<float>(w), static_cast<float>(h), 0, 1};
    ctx_->RSSetViewports(1, &vp);
    ctx_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ctx_->VSSetShader(vs_.Get(), nullptr, 0);
    ctx_->PSSetShader(ps, nullptr, 0);
    ID3D11Buffer* cbs[] = {cb_.Get()};
    ctx_->PSSetConstantBuffers(0, 1, cbs);
    ID3D11SamplerState* smps[] = {sampler_.Get()};
    ctx_->PSSetSamplers(0, 1, smps);
    ID3D11ShaderResourceView* srvs[] = {input, input2, input3};
    ctx_->PSSetShaderResources(0, 3, srvs);
    ctx_->Draw(3, 0);
    ID3D11ShaderResourceView* none[] = {nullptr, nullptr, nullptr};
    ctx_->PSSetShaderResources(0, 3, none);
  }

  // Dessine le verre a la position COURANTE de la fenetre (thread de l'interface uniquement). Ne bloque jamais :
  // si l'affichage n'a pas encore consomme l'image precedente, on reessaie 2 ms plus tard.
  void render() {
    if (down_ || !glass_ || !owner_ || !IsWindow(owner_)) return;
    // Reentrance : SetWindowPos ci-dessous renvoie des WM_WINDOWPOSCHANGED a la fenetre Electron (sous-classee),
    // donc ici-meme, alors que le verrou GPU est tenu.
    if (rendering_) return;
    struct Guard {
      bool& flag;
      explicit Guard(bool& f) : flag(f) { flag = true; }
      ~Guard() { flag = false; }
    } guard(rendering_);
    if (!IsWindowVisible(owner_) || IsIconic(owner_)) { ShowWindow(glass_, SW_HIDE); return; }
    RECT wr;
    if (!GetWindowRect(owner_, &wr)) return;
    const int x = wr.left, y = wr.top, w = wr.right - wr.left, h = wr.bottom - wr.top;
    if (w <= 0 || h <= 0 || w > 4096 || h > 4096) return;
    if (!device_ready_) return;
    std::lock_guard<std::mutex> lock(gpu_);
    if (!desktop_srv_ || !have_desktop_) return;
    // La fenetre de verre deborde de `pad` px de chaque cote : place de l'ombre portee (voir backdrop.hlsl).
    const float dpi_scale = static_cast<float>(GetDpiForWindow(owner_)) / 96.0f;
    const int pad = static_cast<int>(std::ceil(40.0f * dpi_scale));
    const int gw = w + 2 * pad, gh = h + 2 * pad;
    if (gw > 4096 || gh > 4096) return;
    if (!ensure_swapchain(gw, gh)) return;
    // Pas d'image libre : on ne bloque pas le thread de l'interface (glissement de la fenetre), on reessaie.
    if (WaitForSingleObjectEx(waitable_, 0, FALSE) != WAIT_OBJECT_0) {
      SetTimer(glass_, kRetryTimer, 2, nullptr);
      return;
    }
    const float radius = 20.0f * dpi_scale;  // epaisseur du verre (px) : plus utilise que pour la marge
    // Marge : la refraction tire le fond depuis jusqu'a DISTANCE (0,55) x rayon hors de la fenetre, plus le flou.
    // Marge : la refraction tire le fond depuis jusqu'a ~70,7 px (CSS) hors de la fenetre, plus le flou.
    const float sigma = blur_ / 3.0f * dpi_scale;  // le Studio : sigma = rayon / 3
    const int margin = static_cast<int>(std::ceil(71.0f * dpi_scale + 3.0f * sigma + 4.0f));
    margin_.store(margin);
    const int bw = w + 2 * margin, bh = h + 2 * margin;
    if (!ensure_blur_targets(bw, bh)) return;
    ComPtr<ID3D11Texture2D> back;
    ComPtr<ID3D11RenderTargetView> back_rtv;
    if (FAILED(swapchain_->GetBuffer(0, IID_PPV_ARGS(&back))) ||
        FAILED(device_->CreateRenderTargetView(back.Get(), nullptr, &back_rtv))) {
      return;
    }
    Cb cb = {};
    cb.winPos[0] = static_cast<float>(x - origin_x_);
    cb.winPos[1] = static_cast<float>(y - origin_y_);
    cb.size[0] = static_cast<float>(w);
    cb.size[1] = static_cast<float>(h);
    cb.texSize[0] = static_cast<float>(out_w_);
    cb.texSize[1] = static_cast<float>(out_h_);
    cb.blurSize[0] = static_cast<float>(bw);
    cb.blurSize[1] = static_cast<float>(bh);
    cb.margin = static_cast<float>(margin);
    cb.corner = corner_ * dpi_scale;
    cb.scale = dpi_scale;
    cb.radius = radius;
    cb.sigma = sigma;
    cb.tint = tint_;
    cb.shadowPad = static_cast<float>(pad);
    ctx_->UpdateSubresource(cb_.Get(), 0, nullptr, &cb, 0, 0);
    draw_pass(tmp_.rtv.Get(), bw, bh, ps_blur_h_.Get(), desktop_srv_.Get());
    draw_pass(blur_tex_.rtv.Get(), bw, bh, ps_blur_v_.Get(), tmp_.srv.Get());
    draw_pass(back_rtv.Get(), gw, gh, ps_main_.Get(), blur_tex_.srv.Get());
    ID3D11RenderTargetView* no_target[] = {nullptr};
    ctx_->OMSetRenderTargets(1, no_target, nullptr);
    // Position et taille de la fenetre de verre : juste SOUS la fenetre Electron (z-ordre), au meme endroit.
    if (!placed_ || shown_ == hold_ || x != last_x_ || y != last_y_ || w != last_w_ || h != last_h_) {
      SetWindowPos(glass_, owner_, x - pad, y - pad, gw, gh, SWP_NOACTIVATE | (hold_ ? 0 : SWP_SHOWWINDOW));
      placed_ = true;
      shown_ = !hold_;
      last_x_ = x; last_y_ = y; last_w_ = w; last_h_ = h;
    }
    swapchain_->Present(0, 0);
    if (on_ready_) {
      // Premier verre a l'ecran : la page peut devenir transparente et la fenetre visible.
      napi_call_threadsafe_function(on_ready_, nullptr, napi_tsfn_nonblocking);
      napi_release_threadsafe_function(on_ready_, napi_tsfn_release);
      on_ready_ = nullptr;
    }
    // La page (fenetre Electron, qui porte le texte) doit rester JUSTE AU-DESSUS du verre.
    if (GetWindow(glass_, GW_HWNDPREV) != owner_) {
      SetWindowPos(glass_, owner_, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
  }

  void capture_loop() {
    {
      std::lock_guard<std::mutex> lock(gpu_);
      if (!create_device()) return;  // sans verre : la page garde son fond de repli (rappel « pret » jamais appele)
      device_ready_ = true;
    }
    bool open = open_output();
    while (!stopped_.load()) {
      if (!open || dups_.empty()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
        open = open_output();
        continue;
      }
      bool redraw = false;
      bool lost = false;
      bool any = false;
      for (Dup& d : dups_) {
        DXGI_OUTDUPL_FRAME_INFO info;
        ComPtr<IDXGIResource> resource;
        // Attente NULLE : un AcquireNextFrame qui patiente (jusqu'a 8 ms) tient le verrou du contexte D3D11 partage
        // (SetMultithreadProtected) et le thread de l'interface, qui dessine avec ce meme contexte, y restait
        // bloque ~10 ms a chaque rendu. On interroge plutot toutes les ~1 ms.
        HRESULT hr = d.dup->AcquireNextFrame(0, &info, &resource);
        if (hr == DXGI_ERROR_WAIT_TIMEOUT) continue;
        if (FAILED(hr)) { lost = true; break; }  // ACCESS_LOST : changement de resolution, ecran verrouille, UAC...
        any = true;
        // Une image sans changement du bureau (seulement le pointeur : LastPresentTime == 0) a une texture VIDE :
        // la copier par-dessus effacerait le bureau et donnerait un verre noir.
        if (info.LastPresentTime.QuadPart != 0) {
          // Zone qui compte : sous la fenetre, marge de refraction comprise (repere du bureau virtuel).
          RECT region = {};
          RECT wr;
          const int m = margin_.load();
          const bool have_region = GetWindowRect(owner_, &wr) != 0;
          if (have_region) {
            region = {std::max(0L, wr.left - origin_x_ - m), std::max(0L, wr.top - origin_y_ - m),
                      std::min(static_cast<LONG>(out_w_), wr.right - origin_x_ + m),
                      std::min(static_cast<LONG>(out_h_), wr.bottom - origin_y_ + m)};
          }
          // Meme zone dans le repere de cette sortie (image de la sortie seule), tronquee a ses bords.
          const LONG ox = d.rc.left - origin_x_, oy = d.rc.top - origin_y_;
          RECT local = {std::max(0L, region.left - ox), std::max(0L, region.top - oy),
                        std::min(d.rc.right - d.rc.left, region.right - ox),
                        std::min(d.rc.bottom - d.rc.top, region.bottom - oy)};
          const bool overlaps = have_region && local.left < local.right && local.top < local.bottom;
          const bool touched = !have_region || (overlaps && frame_touches(d.dup.Get(), info, local));
          ComPtr<ID3D11Texture2D> texture;
          if (SUCCEEDED(resource.As(&texture))) {
            std::lock_guard<std::mutex> lock(gpu_);
            ctx_->CopySubresourceRegion(desktop_copy_.Get(), 0, static_cast<UINT>(ox), static_cast<UINT>(oy), 0,
                                        texture.Get(), 0, nullptr);
            const bool first = !have_desktop_;
            have_desktop_ = true;
            // Windows annonce une nouvelle image a CHAQUE mise a jour d'une fenetre, meme exclue de la capture
            // (notre verre, l'animation du splash) : sans ce controle, le verre se redessinait en boucle a la
            // cadence de l'ecran (thread de l'interface sature, glisser impossible, systeme gele). On ne
            // redessine que si les pixels sous la fenetre ont reellement change.
            redraw = redraw || first || (touched && have_region && region_changed(region));
          }
        }
        d.dup->ReleaseFrame();
      }
      if (lost) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        open = open_output();
        continue;
      }
      if (!any) std::this_thread::sleep_for(std::chrono::milliseconds(1));
      // Le dessin se fait sur le thread de l'interface (proprietaire de la fenetre).
      if (redraw) PostMessageW(glass_, WM_APEX_RENDER, 0, 0);
    }
  }

  // Une zone modifiee ou deplacee annoncee par Windows recoupe-t-elle `region` ?
  bool frame_touches(IDXGIOutputDuplication* duplication, const DXGI_OUTDUPL_FRAME_INFO& info, const RECT& region) {
    if (info.TotalMetadataBufferSize == 0) return true;  // pas de detail : on suppose que oui
    meta_.resize(info.TotalMetadataBufferSize);
    auto hits = [&](const RECT& r) {
      return r.left < region.right && r.right > region.left && r.top < region.bottom && r.bottom > region.top;
    };
    UINT size = 0;
    if (SUCCEEDED(duplication->GetFrameMoveRects(static_cast<UINT>(meta_.size()),
                                                  reinterpret_cast<DXGI_OUTDUPL_MOVE_RECT*>(meta_.data()), &size))) {
      const auto* moves = reinterpret_cast<const DXGI_OUTDUPL_MOVE_RECT*>(meta_.data());
      for (UINT i = 0; i < size / sizeof(DXGI_OUTDUPL_MOVE_RECT); ++i) {
        if (hits(moves[i].DestinationRect)) return true;
      }
    } else {
      return true;
    }
    if (SUCCEEDED(duplication->GetFrameDirtyRects(static_cast<UINT>(meta_.size()), reinterpret_cast<RECT*>(meta_.data()),
                                                   &size))) {
      const auto* dirty = reinterpret_cast<const RECT*>(meta_.data());
      for (UINT i = 0; i < size / sizeof(RECT); ++i) {
        if (hits(dirty[i])) return true;
      }
      return false;
    }
    return true;
  }

  // Les pixels de `region` (dans desktop_copy_) different-ils de la derniere fois ? Verrou GPU tenu.
  bool region_changed(const RECT& region) {
    const int w = region.right - region.left, h = region.bottom - region.top;
    if (w <= 0 || h <= 0) return false;
    bool resized = false;
    if (!cmp_staging_ || cmp_w_ != w || cmp_h_ != h) {
      cmp_staging_.Reset();
      D3D11_TEXTURE2D_DESC td = {};
      td.Width = static_cast<UINT>(w);
      td.Height = static_cast<UINT>(h);
      td.MipLevels = 1;
      td.ArraySize = 1;
      td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
      td.SampleDesc.Count = 1;
      td.Usage = D3D11_USAGE_STAGING;
      td.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
      if (FAILED(device_->CreateTexture2D(&td, nullptr, &cmp_staging_))) return true;
      cmp_w_ = w;
      cmp_h_ = h;
      cmp_prev_.assign(static_cast<size_t>(w) * h * 4, 0);
      resized = true;
    }
    D3D11_BOX box = {static_cast<UINT>(region.left), static_cast<UINT>(region.top), 0, static_cast<UINT>(region.right),
                     static_cast<UINT>(region.bottom), 1};
    ctx_->CopySubresourceRegion(cmp_staging_.Get(), 0, 0, 0, 0, desktop_copy_.Get(), 0, &box);
    D3D11_MAPPED_SUBRESOURCE mapped;
    if (FAILED(ctx_->Map(cmp_staging_.Get(), 0, D3D11_MAP_READ, 0, &mapped))) return true;
    bool changed = resized;
    const size_t row_bytes = static_cast<size_t>(w) * 4;
    for (int row = 0; row < h; ++row) {
      const uint8_t* src = static_cast<const uint8_t*>(mapped.pData) + static_cast<size_t>(row) * mapped.RowPitch;
      uint8_t* prev = cmp_prev_.data() + static_cast<size_t>(row) * row_bytes;
      if (std::memcmp(src, prev, row_bytes) != 0) {
        changed = true;
        std::memcpy(prev, src, row_bytes);
      }
    }
    ctx_->Unmap(cmp_staging_.Get(), 0);
    return changed;
  }

  HWND owner_ = nullptr, glass_ = nullptr;
  float corner_ = 20.0f, tint_ = 0.0f, warp_ = 4.0f, blur_ = 10.0f;
  std::thread thread_;
  std::atomic<bool> stopped_{false}, down_{false};
  bool subclassed_ = false;
  bool taskbar_ = false;
  bool hold_ = false;
  bool placed_ = false;
  bool have_desktop_ = false;
  bool rendering_ = false;
  bool shown_ = false;
  int last_x_ = 0, last_y_ = 0, last_w_ = 0, last_h_ = 0;
  napi_threadsafe_function on_ready_ = nullptr;
  std::atomic<bool> device_ready_{false};
  std::atomic<int> margin_{0};
  std::vector<uint8_t> meta_;
  ComPtr<ID3D11Texture2D> cmp_staging_;
  int cmp_w_ = 0, cmp_h_ = 0;
  std::vector<uint8_t> cmp_prev_;
  std::mutex gpu_;
  ComPtr<ID3D11Device> device_;
  ComPtr<ID3D11DeviceContext> ctx_;
  ComPtr<ID3D11VertexShader> vs_;
  ComPtr<ID3D11PixelShader> ps_blur_h_, ps_blur_v_, ps_main_;
  ComPtr<ID3D11Buffer> cb_;
  ComPtr<ID3D11SamplerState> sampler_;
  struct Dup { ComPtr<IDXGIOutputDuplication> dup; RECT rc = {}; };
  std::vector<Dup> dups_;
  ComPtr<ID3D11Texture2D> desktop_copy_;
  ComPtr<ID3D11ShaderResourceView> desktop_srv_;
  Target tmp_, blur_tex_;
  int origin_x_ = 0, origin_y_ = 0, out_w_ = 1, out_h_ = 1;
  int blur_w_ = 0, blur_h_ = 0, sc_w_ = 0, sc_h_ = 0;
  ComPtr<IDXGISwapChain2> swapchain_;
  HANDLE waitable_ = nullptr;
  ComPtr<IDCompositionDevice> dc_device_;
  ComPtr<IDCompositionTarget> dc_target_;
  ComPtr<IDCompositionVisual> dc_visual_;
};

std::unique_ptr<Glass> g_glass;

napi_value boolean(napi_env env, bool value) {
  napi_value v;
  napi_get_boolean(env, value, &v);
  return v;
}

double number_property(napi_env env, napi_value object, const char* name, double fallback) {
  napi_value v;
  double d;
  if (napi_get_named_property(env, object, name, &v) == napi_ok && napi_get_value_double(env, v, &d) == napi_ok) return d;
  return fallback;
}

napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) return boolean(env, false);
  bool is_buffer = false;
  napi_is_buffer(env, argv[0], &is_buffer);
  if (!is_buffer) return boolean(env, false);
  void* data = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, argv[0], &data, &length);
  HWND hwnd = nullptr;
  if (!data || length < sizeof(HWND)) return boolean(env, false);
  std::memcpy(&hwnd, data, sizeof(HWND));
  if (!IsWindow(hwnd)) return boolean(env, false);
  float corner = 20.0f, tint = 0.0f, warp = 4.0f, blur = 10.0f;
  bool taskbar = false;
  bool hold = false;
  if (argc >= 2) {
    corner = static_cast<float>(number_property(env, argv[1], "corner", corner));
    tint = static_cast<float>(number_property(env, argv[1], "tint", tint));
    warp = static_cast<float>(number_property(env, argv[1], "warp", warp));
    blur = static_cast<float>(number_property(env, argv[1], "blur", blur));
    taskbar = number_property(env, argv[1], "taskbar", 0.0) != 0.0;
    hold = number_property(env, argv[1], "hold", 0.0) != 0.0;
  }
  napi_threadsafe_function on_ready = nullptr;
  if (argc >= 3) {
    napi_valuetype type;
    napi_typeof(env, argv[2], &type);
    if (type == napi_function) {
      napi_value name;
      napi_create_string_utf8(env, "apex-backdrop-ready", NAPI_AUTO_LENGTH, &name);
      napi_create_threadsafe_function(env, argv[2], nullptr, name, 0, 1, nullptr, nullptr, nullptr, nullptr, &on_ready);
    }
  }
  g_glass.reset();
  auto glass = std::make_unique<Glass>(hwnd, corner, tint, warp, blur, on_ready);
  glass->set_taskbar(taskbar);
  glass->set_hold(hold);
  if (!glass->start()) return boolean(env, false);
  g_glass = std::move(glass);
  return boolean(env, true);
}

// release() : montre le verre retenu (option `hold` de start).
napi_value release(napi_env env, napi_callback_info) {
  if (g_glass) g_glass->release();
  return boolean(env, true);
}

napi_value stop(napi_env env, napi_callback_info) {
  g_glass.reset();
  return boolean(env, true);
}

}  // namespace

NAPI_MODULE_INIT() {
  napi_property_descriptor props[] = {
      {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stop", nullptr, stop, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"release", nullptr, release, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 3, props);
  return exports;
}

#else
NAPI_MODULE_INIT() { return exports; }
#endif
