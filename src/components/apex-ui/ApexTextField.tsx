import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './ApexTextField.module.scss';

type InputProps = InputHTMLAttributes<HTMLInputElement> & { multiline?: false };
type AreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { multiline: true };

/**
 * Le champ de texte d'Apex (une ligne, ou plusieurs avec `multiline`). Pour un nombre : `ApexNumberField`, jamais un
 * `<input type="number">`.
 */
export const ApexTextField = forwardRef<HTMLInputElement | HTMLTextAreaElement, InputProps | AreaProps>((props, ref) => {
  if (props.multiline) {
    const { multiline: _multiline, className, ...rest } = props;
    return (
      <div className={styles.root}>
        <textarea ref={ref as React.Ref<HTMLTextAreaElement>} className={clsx(styles.input, styles.multiline, className)} {...rest} />
      </div>
    );
  }
  const { multiline: _multiline, className, ...rest } = props;
  return (
    <div className={styles.root}>
      <input ref={ref as React.Ref<HTMLInputElement>} className={clsx(styles.input, className)} {...rest} />
    </div>
  );
});
ApexTextField.displayName = 'ApexTextField';
