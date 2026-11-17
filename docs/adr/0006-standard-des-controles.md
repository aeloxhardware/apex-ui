# ADR 0006 — Un standard unique pour tous les contrôles, tiré de l'interface

Date : 2026-11-17. Décision de l'utilisateur : le kit shadcn (`components/ui`) est jugé laid ; Apex a son propre standard de
contrôles, construit à partir des éléments déjà présents dans l'interface.

**Contexte.** Le kit shadcn n'était presque plus utilisé (3 fichiers). L'interface réelle était faite de contrôles écrits au cas par
cas : chaque panneau avait son bouton, son champ, son interrupteur, sa liste (ExtrudePanel, AmsOverlays, AxisSidebar, ViewCube…),
avec des valeurs légèrement différentes (rayons 6/7/8/10, fonds .03/.06/.08, bordures présentes ou non).

**Décision.**
1. `src/styles/_apex-ui.scss` : les jetons (encre, fonds de champ, verre, ambre des états actifs, anneau de focus, rayons,
   transitions), relevés sur l'interface existante, et les mixins `reset`, `glass-surface`, `control`, `selected`, `field`. Un contrôle
   n'écrit aucune couleur, ombre ni rayon de son cru.
2. `src/components/apex-ui/` : un composant par contrôle, exportés par `index.ts` : `ApexButton` (variantes `ghost`/`glass`/`field`,
   tailles `sm`/`md`/`lg`, `icon`, `active`), `ApexToggle`, `ApexTextField`, `ApexSelect` (ex-GlassSelect, sur Radix Popover),
   et, déjà existants, `ApexSlider`, `ApexNumberField`, `ApexCheckbox`.
3. Le style des états est unique : repos (encre à 65 %), survol (blanc + fond léger), actif (ambre + halo), focus clavier (anneau
   ambre), désactivé (45 %).
4. Plus aucun nouveau contrôle n'est écrit en dehors de ce dossier ; un cas manquant étend le composant (variante, prop).

5. **Couleur de mise en valeur** (utilisateur, 2026-11-17) : l'orange ambre actuel, `#f59e0b`, est LA couleur de surlignage de tout
   nouvel élément (`$amber` en SCSS, `--apex-highlight` en CSS, dans `globals.css`). Elle ne sert qu'à mettre en valeur : état actif,
   choix courant, action principale. On la dose : une ou deux mises en valeur par écran, tout le reste est neutre (blanc
   translucide). Le cyan n'est plus une couleur de mise en valeur. Premier cas : le cadre de rendu 4K (Ctrl + Maj + 4), neutre
   sauf le bouton « Rendre et exporter » (`ApexButton variant="accent"`).
6. Le panneau du ViewCube n'existe que dans les espaces 3D (Préparation, Prévisualisation, Modélisation) ; il est porté par un
   portail, donc l'invisibilité d'Accueil / Paramètres ne le masque pas : `Index.tsx` ne le monte pas hors 3D.

**Reste à faire (migration).** Les boutons écrits à la main dans `SidebarParts`, `FilamentFilterPanel`, `GCodeConversionCard`,
`GCodeLineTypeLegend`, `FilamentPickerMenu`, `SoundLibrary`, `SliceModal`, `ParamsPanel`, `NotificationStack`, `HomeProjects`,
`FileSidebar`, `EngineSettingsEditor` ; les `<input>` des panneaux (Édition, Filament, Catégories) ; les onglets
(`PreviewUpperTabs`) ; `GCodeLineTypeLegend` (Popover du kit). Ensuite seulement, retirer `components/ui` et ses dépendances Radix
inutilisées.
