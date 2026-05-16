import { API_BASE } from "@/lib/api";
import { toast } from "sonner";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import PirateWheel from "@/components/PirateWheel";

type StructuredField = {
    id: string;
    type: string;
    label: string;
    variableKey: string;
    required: boolean;
    autoFill: boolean;
    showInSummary: boolean;
    strictnessOverride?: number | null;
    prompt?: string | null;
    options?: unknown;
};

type StructuredSection = {
    id: string;
    title: string;
    fields: StructuredField[];
};

type StructuredTemplate = {
    sections?: StructuredSection[];
    strictness?: number | null;
    [key: string]: unknown;
};

type Template = {
    id: string;
    name: string;
    templateType?: 'simple' | 'structured';
    structured?: StructuredTemplate | null;
    llmModel?: string | null;
    version: number;
    authorId: string;
    createdAt: string;
    updatedAt: string;
    isDeleted: boolean;
};

type Props = {
    template: Template;
};

const formatDateTime = (value: string | null | undefined) => {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime())
        ? value
        : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const FieldFlag = ({ on, label }: { on: boolean; label: string }) => (
    <span
        className={
            'inline-block border-2 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider ' +
            (on
                ? 'border-black bg-black text-white'
                : 'border-black/40 bg-white text-black/40 line-through')
        }
    >
        {label}
    </span>
);

const StudioTemplateView = ({ template }: Props) => {
    const auth = useAuth();
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);

    const structured = template.structured || {};
    const sections = Array.isArray(structured.sections) ? structured.sections : [];

    const handleDelete = async () => {
        setBusy(true);
        try {
            const res = await fetch(`${API_BASE}/api/templates/${template.id}/delete`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`,
                },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `status ${res.status}`);
            toast.success(data.message || 'Template moved to trash.');
            navigate('/templates');
        } catch (err: any) {
            toast.error('Error deleting template. Please try again.');
            console.log('Error deleting template:', err);
            setBusy(false);
        }
    };

    const handleRestore = async () => {
        setBusy(true);
        try {
            const res = await fetch(`${API_BASE}/api/templates/${template.id}/restore`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`,
                },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `status ${res.status}`);
            toast.success(data.message || 'Template restored.');
            navigate('/templates');
        } catch (err: any) {
            toast.error('Error restoring template. Please try again.');
            console.log('Error restoring template:', err);
            setBusy(false);
        }
    };

    const handleDeletePermanently = async () => {
        if (!confirm('Permanently delete this template? This cannot be undone. Notes created from it keep their content but lose the template link.')) {
            return;
        }
        setBusy(true);
        try {
            const res = await fetch(`${API_BASE}/api/templates/${template.id}/delete-permanently`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${auth.token}` },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data.error || `Could not delete template (status ${res.status}).`);
                setBusy(false);
                return;
            }
            toast.success(data.message || 'Template permanently deleted.');
            navigate('/templates');
        } catch (err: any) {
            toast.error('Error permanently deleting template. Please try again.');
            console.log('Error permanently deleting template:', err);
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-5">
            <div className="border-2 border-[#5d1d91] bg-[#5d1d91]/10 p-3 text-sm">
                <p>
                    <span className="font-black uppercase tracking-wider text-[#5d1d91]">Studio template</span>
                    {' '}— built in PrivateScribe Studio. View-only here; edit the source in Studio and re-import to update.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Name</p>
                    <p className="font-semibold">{template.name}</p>
                </div>
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">LLM Model</p>
                    <p className={template.llmModel ? '' : 'italic text-muted-foreground'}>
                        {template.llmModel || 'Default'}
                    </p>
                </div>
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Version</p>
                    <p>v{template.version}</p>
                </div>
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Strictness</p>
                    <p>{typeof structured.strictness === 'number' ? `${structured.strictness}/100` : '—'}</p>
                </div>
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Created</p>
                    <p>{formatDateTime(template.createdAt)}</p>
                </div>
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Updated</p>
                    <p>{formatDateTime(template.updatedAt)}</p>
                </div>
                <div className="sm:col-span-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Author ID</p>
                    <p className="font-mono text-xs break-all">{template.authorId}</p>
                </div>
            </div>

            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-black">Sections</h2>
                {sections.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">
                        No sections in this template's structured payload.
                    </p>
                )}
                {sections.map((section, si) => (
                    <div key={section.id || si} className="border-2 border-black bg-white">
                        <div className="border-b-2 border-black bg-black px-3 py-2">
                            <p className="font-black uppercase tracking-wider text-white">
                                {section.title || `Section ${si + 1}`}
                            </p>
                        </div>
                        <div className="flex flex-col divide-y-2 divide-black/10">
                            {(section.fields || []).length === 0 && (
                                <p className="px-3 py-2 text-sm text-muted-foreground italic">
                                    No fields in this section.
                                </p>
                            )}
                            {(section.fields || []).map((field, fi) => (
                                <div key={field.id || fi} className="px-3 py-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span
                                            className="inline-block border-2 border-[#5d1d91] bg-[#5d1d91] px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider text-white"
                                            title={`Field type: ${field.type}`}
                                        >
                                            {field.type}
                                        </span>
                                        <span className="font-semibold">{field.label}</span>
                                        <span className="font-mono text-xs text-muted-foreground">
                                            {field.variableKey}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1">
                                        <FieldFlag on={!!field.required} label="Required" />
                                        <FieldFlag on={!!field.autoFill} label="Auto-fill" />
                                        <FieldFlag on={!!field.showInSummary} label="In summary" />
                                        {typeof field.strictnessOverride === 'number' && (
                                            <span className="inline-block border-2 border-black bg-white px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider">
                                                Strictness {field.strictnessOverride}/100
                                            </span>
                                        )}
                                    </div>
                                    {field.prompt && (
                                        <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                                            {field.prompt}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <details className="border-2 border-black bg-white">
                <summary className="cursor-pointer px-3 py-2 font-black uppercase tracking-wider">
                    Raw JSON
                </summary>
                <pre className="overflow-auto bg-black/5 p-3 font-mono text-xs">
                    {JSON.stringify(structured, null, 2)}
                </pre>
            </details>

            {busy && (
                <div className="flex flex-col w-full justify-center items-center mt-4">
                    <PirateWheel isRotating={true} />
                    <p className="text-primary">Working...</p>
                </div>
            )}

            {!busy && (
                <div className="flex justify-end items-center gap-4 mt-2">
                    {template.isDeleted ? (
                        <>
                            <NeoButton type="button" label="Restore" onClick={handleRestore} />
                            <NeoButton
                                type="button"
                                label="Delete permanently"
                                backgroundColor="#dc2626"
                                textColor="#ffffff"
                                onClick={handleDeletePermanently}
                            />
                        </>
                    ) : (
                        <NeoButton type="button" onClick={handleDelete}>
                            <Trash2 />
                        </NeoButton>
                    )}
                </div>
            )}
        </div>
    );
};

export default StudioTemplateView;
