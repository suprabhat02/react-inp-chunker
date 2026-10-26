import { INSTALL_COMMAND } from '../content/site.ts';
import { CopyButton } from './CopyButton.tsx';

export function InstallCommand() {
  return (
    <div className="install">
      <code className="install__command">
        <span className="install__prompt" aria-hidden="true">
          $
        </span>{' '}
        {INSTALL_COMMAND}
      </code>
      <CopyButton text={INSTALL_COMMAND} label="install command" />
    </div>
  );
}
