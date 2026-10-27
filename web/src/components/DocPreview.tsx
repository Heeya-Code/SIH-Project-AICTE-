import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { download, errMsg, fetchBlob } from '../lib/api';
import { Button, ErrorBox, Modal, Spinner, useToast } from './ui';

// Fetches the file with the user's own credentials (never a public URL) and shows it in the page when the browser can.
export function DocPreview({ id, path, name, fileName, sample = false, onClose }: { id?: number; path?: string; name: string; fileName: string; sample?: boolean; onClose: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null); const [type, setType] = useState(''); const [err, setErr] = useState<unknown>(null);
  const endpoint = path ?? `/documents/${id}/download`;
  useEffect(() => {
    let made: string | null = null; let dead = false;
    fetchBlob(endpoint).then(r => { if (dead) return; made = URL.createObjectURL(r.blob); setUrl(made); setType(r.type); }).catch(e => !dead && setErr(e));
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [endpoint]);
  const canShow = type.startsWith('application/pdf') || type.startsWith('image/');
  return (
    <Modal title={`Preview: ${name}`} wide onClose={onClose} footer={<><Button onClick={() => download(endpoint, fileName).catch(e => toast.err(e.message))}><Download className="h-4 w-4" aria-hidden />Download</Button><Button variant="primary" onClick={onClose}>Close</Button></>}>
      {err ? <ErrorBox error={err} /> : !url ? <Spinner label="Loading the document" /> : !canShow ? <p>This file type cannot be previewed here. Use Download to open it.</p>
        : type.startsWith('image/') ? <img src={url} alt={`Preview of ${name}`} className="mx-auto max-h-[65vh] max-w-full rounded border border-line" />
        : <iframe src={url} title={`Preview of ${name}`} className="h-[65vh] w-full rounded border border-line" />}
      <p className="text-[12px] text-muted">{fileName}. {sample ? 'Fictional sample only; not an official certificate or verified evidence.' : 'Opening a preview is recorded only as a download in the audit trail when you use Download.'}</p>
    </Modal>);
}
void errMsg;
