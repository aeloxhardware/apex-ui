import { INCH_TO_MM, type ModelUnit } from '@/utils/modelUnit';
import styles from './ScaleUnitPrompt.module.scss';

export interface ScaleUnitSuggestion {
  name: string;
  /** Unité à proposer. */
  unit: ModelUnit;
  /** Plus grande dimension affichée, dans l'unité de lecture actuelle (mm si `unit` vaut « in », et inversement). */
  sizeMm: number;
}

interface ScaleUnitPromptProps {
  suggestion: ScaleUnitSuggestion;
  onAccept: (suggestion: ScaleUnitSuggestion) => void;
  onDismiss: () => void;
}

const format = (value: number) => value.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Carte proposée après l'import d'un modèle trop petit ou trop grand pour sa lecture en mm. */
export default function ScaleUnitPrompt({ suggestion, onAccept, onDismiss }: ScaleUnitPromptProps) {
  const { name, unit, sizeMm } = suggestion;
  // Lecture en pouces : le modèle est 25,4 fois plus grand, donc le texte part de la taille actuelle.
  const after = unit === 'in' ? sizeMm * INCH_TO_MM : sizeMm / INCH_TO_MM;
  const title = unit === 'in' ? 'Modèle très petit' : 'Modèle très grand';
  const body = unit === 'in'
    ? <>« {name} » ne mesure que {format(sizeMm)} mm : il est peut-être dessiné en pouces. Le lire en pouces le ramène à {format(after)} mm.</>
    : <>« {name} » mesure {format(sizeMm)} mm : il est peut-être dessiné en millimètres. Le lire en millimètres le ramène à {format(after)} mm.</>;
  const acceptLabel = unit === 'in' ? 'Lire en pouces' : 'Lire en millimètres';

  return (
    <div className={styles.prompt} role="alertdialog" aria-label={title}>
      <div className={styles.title}>{title}</div>
      <div className={styles.body}>{body}</div>
      <div className={styles.actions}>
        <button type="button" className={styles.keep} onClick={onDismiss}>Garder</button>
        <button type="button" className={styles.accept} onClick={() => onAccept(suggestion)}>{acceptLabel}</button>
      </div>
    </div>
  );
}
