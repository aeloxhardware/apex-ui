# ![pex-logo](./public/mini-logo.png) Apex Slicer UI

![frontPhoto](./.github/assets/title.png)

[English](README.md) | [Français](README-fr.md) | [Čeština](README-cz.md)

The future UI for Apex Slicer, including modern UX effects. Still in developement.

## Online Demo
*There is no demo of this interface for now.*

## Screenshots

<table align="center">
  <tr>
    <td><img src="./.github/assets/title-video.gif" width="240" ></td>
    <td><img src="./.github/assets/screen-shot-1.png" width="240" /></td>
  </tr>
  <tr>
    <td><img src="./.github/assets/screen-shot-2.png" width="240" /></td>
    <td><img src="./.github/assets/screen-shot-3.png" width="240" /></td>
  </tr>
</table>

## Features

**✨ Modern User Experience:**

- Fluent Interface
- Liquid Glass Effects
- Fluid Animations
- Floating Elements
- Merging Tools
- Anti-aliasing

![frontPhoto](./.github/assets/bar.png)

## Technical Highlights

- Babylon.js (WebGL2) viewport for the build plate, printer boundary and model manipulation
- Custom GLSL shader for the printer build-volume boundary (out-of-bounds highlighting, fresnel glass look)
- CSS/backdrop-filter based glassmorphism panels, with an adjustable blur level
- UI built with shadcn/ui + Radix primitives, styled with Tailwind and per-component SCSS modules
- Panels and viewport communicate through a lightweight custom event bus (no shared state/store)


## TODO

- [x] Floating 3/4/5-Axis Selector
- [ ] Light Theme
- [ ] Toolbar Moving
- [ ] Liquid Jello Menus
- [ ] Algorithm Linking
- [ ] Printer Presets
- [ ] Collision Checkup
- [ ] G-Code Preview
- [ ] Drag-And-Drop Interface

## Credits & Citations

Thanks to the following resources and inspirations:

- [Joshua Bird](https://github.com/jyjblrd) and his wonderful [S4 Slicer algorithm](https://github.com/jyjblrd/S4_Slicer)
- [Orca Slicer](https://github.com/OrcaSlicer/OrcaSlicer) & [Bambu Studio](https://github.com/bambulab/BambuStudio)
- [Ultimaker Cura](https://github.com/Ultimaker/CuraEngine)
- [Iyinchao's work](https://github.com/iyinchao/liquid-glass-studio)

## License

[GNU GPL 3.0](LICENSE)
