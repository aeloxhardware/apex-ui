/** Frontières d'architecture (cf. CLAUDE.md, « Quality gate »). Les violations existantes sont comptées par
 * scripts/check-quality.cjs et ne peuvent que diminuer ; toute nouvelle violation échoue. */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', comment: 'Aucun cycle d\'import.', from: {}, to: { circular: true } },
    {
      name: 'utils-are-low-level', severity: 'error',
      comment: 'src/utils ne dépend ni des composants, ni des hooks, ni des pages.',
      from: { path: '^src/utils/' }, to: { path: '^src/(components|hooks|pages)/' },
    },
    {
      name: 'modeling-is-low-level', severity: 'error',
      comment: 'src/modeling (modèle de données) ne dépend pas de l\'interface.',
      from: { path: '^src/modeling/' }, to: { path: '^src/(components|hooks|pages)/' },
    },
    {
      name: 'hooks-below-components', severity: 'error',
      comment: 'Un hook ne dépend pas des pages.', from: { path: '^src/hooks/' }, to: { path: '^src/pages/' },
    },
    {
      name: 'components-below-pages', severity: 'error',
      comment: 'Un composant ne dépend pas des pages.', from: { path: '^src/components/' }, to: { path: '^src/pages/' },
    },
    {
      name: 'ui-kit-is-generated', severity: 'error',
      comment: 'src/components/ui (shadcn) ne dépend pas du code d\'Apex.',
      from: { path: '^src/components/ui/' }, to: { path: '^src/(?!components/ui/)', pathNot: '^src/(lib|utils/cn)' },
    },
    {
      name: 'tests-stay-out-of-prod', severity: 'error',
      comment: 'Le code de production n\'importe pas de test.', from: { pathNot: '\.test\.' }, to: { path: '\.test\.' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.app.json' },
    includeOnly: '^src',
    exclude: { path: '\.d\.ts$' },
  },
};
