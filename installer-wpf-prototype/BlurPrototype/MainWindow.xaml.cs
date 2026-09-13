using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace BlurPrototype;

public partial class MainWindow : Window
{
    private enum DWM_WINDOW_CORNER_PREFERENCE
    {
        DWMWCP_DEFAULT = 0,
        DWMWCP_DONOTROUND = 1,
        DWMWCP_ROUND = 2,
        DWMWCP_ROUNDSMALL = 3,
    }

    private enum DWM_SYSTEMBACKDROP_TYPE
    {
        DWMSBT_AUTO = 0,
        DWMSBT_NONE = 1,
        DWMSBT_MAINWINDOW = 2,       // Mica
        DWMSBT_TRANSIENTWINDOW = 3,  // Acrylic
        DWMSBT_TABBEDWINDOW = 4,     // Mica Alt
    }

    private enum DWMWINDOWATTRIBUTE
    {
        DWMWA_WINDOW_CORNER_PREFERENCE = 33,
        DWMWA_SYSTEMBACKDROP_TYPE = 38,
        DWMWA_USE_IMMERSIVE_DARK_MODE = 20,
    }

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct MARGINS
    {
        public int cxLeftWidth;
        public int cxRightWidth;
        public int cyTopHeight;
        public int cyBottomHeight;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);

    // Retire le dessin de la legende/icone de la barre de titre (mais garde
    // le style de fenetre Win32 sous-jacent intact) via uxtheme.dll, ordinal
    // 104 = SetWindowThemeAttribute. C'est l'approche utilisee par wpfui
    // (lepoco/wpfui, WindowBackdrop.RemoveWindowCaption) : contrairement a
    // WindowStyle="None" cote WPF, elle laisse la composition DWM native de
    // la fenetre intacte, ce qui est necessaire pour que le backdrop
    // Acrylic/Mica reste visible au lieu de tomber sur un fond gris/noir
    // opaque impose par le rendu WPF par defaut.
    //
    // Compromis assume (voir CLAUDE.md/discussion) : un petit bouton "fermer"
    // natif reste visible en haut a droite. Toute tentative de le retirer
    // aussi (WindowChrome + CaptionHeight=0) a fait regresser le flou
    // lui-meme (5 essais testes) - conserve tel quel plutot que de risquer
    // une nouvelle regression.
    [StructLayout(LayoutKind.Sequential)]
    private struct WTA_OPTIONS
    {
        public uint dwFlags;
        public uint dwMask;
    }

    private const int WTNCA_NODRAWCAPTION = 0x00000001;
    private const int WTNCA_NODRAWICON = 0x00000002;
    private const int WTNCA_NOMIRRORHELP = 0x00000010;
    private const int WTNCA_NOSYSMENU = 0x00000004;
    private const int WTA_NONCLIENT = 1;

    [DllImport("uxtheme.dll", EntryPoint = "#104")]
    private static extern int SetWindowThemeAttribute(IntPtr hwnd, int attribute, ref WTA_OPTIONS options, uint size);

    public MainWindow()
    {
        InitializeComponent();
        SourceInitialized += OnSourceInitialized;
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var hwnd = new WindowInteropHelper(this).Handle;

        var hwndSource = HwndSource.FromHwnd(hwnd);
        if (hwndSource?.CompositionTarget != null)
        {
            hwndSource.CompositionTarget.BackgroundColor = Colors.Transparent;
        }

        var margins = new MARGINS { cxLeftWidth = -1, cxRightWidth = -1, cyTopHeight = -1, cyBottomHeight = -1 };
        DwmExtendFrameIntoClientArea(hwnd, ref margins);

        var wtaOptions = new WTA_OPTIONS
        {
            dwFlags = WTNCA_NODRAWCAPTION,
            dwMask = WTNCA_NODRAWCAPTION | WTNCA_NODRAWICON | WTNCA_NOMIRRORHELP | WTNCA_NOSYSMENU,
        };
        SetWindowThemeAttribute(hwnd, WTA_NONCLIENT, ref wtaOptions, (uint)Marshal.SizeOf<WTA_OPTIONS>());

        int cornerPref = (int)DWM_WINDOW_CORNER_PREFERENCE.DWMWCP_ROUND;
        DwmSetWindowAttribute(hwnd, (int)DWMWINDOWATTRIBUTE.DWMWA_WINDOW_CORNER_PREFERENCE, ref cornerPref, sizeof(int));

        int backdrop = (int)DWM_SYSTEMBACKDROP_TYPE.DWMSBT_TRANSIENTWINDOW; // Acrylic
        DwmSetWindowAttribute(hwnd, (int)DWMWINDOWATTRIBUTE.DWMWA_SYSTEMBACKDROP_TYPE, ref backdrop, sizeof(int));

        int darkMode = 1;
        DwmSetWindowAttribute(hwnd, (int)DWMWINDOWATTRIBUTE.DWMWA_USE_IMMERSIVE_DARK_MODE, ref darkMode, sizeof(int));
    }
}
