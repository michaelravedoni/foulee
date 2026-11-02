import { OpfsProvider } from './opfs.js';

/**
 * Dossier choisi par l'utilisateur sur son disque (File System Access API : Chrome, Edge, Opera sur ordinateur).
 * Même logique que OPFS, sur un dossier visible : synchronisé par OneDrive, iCloud Drive, Dropbox…
 */
export class DirectoryProvider extends OpfsProvider {
  override readonly name: string;

  constructor(private readonly handle: FileSystemDirectoryHandle) {
    super(`dossier:${handle.name}`);
    this.name = `dossier « ${handle.name} »`;
  }

  static override isSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  protected override async root(): Promise<FileSystemDirectoryHandle> {
    return this.handle;
  }

  /** Vérifie (et au besoin demande) l'autorisation de lire et d'écrire dans le dossier. */
  async ensurePermission(): Promise<boolean> {
    const h = this.handle as FileSystemDirectoryHandle & {
      queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
      requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    if ((await h.queryPermission?.({ mode: 'readwrite' })) === 'granted') return true;
    return (await h.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  }
}
