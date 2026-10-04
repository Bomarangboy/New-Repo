"use client";

import { useActionState, useId, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export type FormState = { error?: string; ok?: string } | null;
type Action = (prev: FormState, data: FormData) => Promise<FormState>;

/** A form wired to a server action that shows plain-language success or error messages. */
export function ActionForm({ action, children, className }: { action: Action; children: ReactNode; className?: string }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className ?? "space-y-4"}>
      {children}
      <FormMessage state={state} />
    </form>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (!state) return null;
  if (state.error) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
        <AlertCircle className="mt-0.5 size-4 shrink-0" /> {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> {state.ok}
      </p>
    );
  }
  return null;
}

export function SubmitButton({ children, variant = "primary", className = "" }: { children: ReactNode; variant?: "primary" | "secondary" | "danger"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`btn-${variant} ${className}`}>
      {pending && <Loader2 className="size-4 animate-spin" />} {children}
    </button>
  );
}

/** Labeled input. IDs are unique per instance, so several forms on one page never clash. */
export function Field({ label, name, type = "text", hint, id, ...rest }: { label: string; name: string; type?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fieldId = id ?? `${name}-${auto}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div>
      <label htmlFor={fieldId} className="label">{label}</label>
      <input id={fieldId} name={name} type={type} className="input" aria-describedby={hintId} {...rest} />
      {hint && <p id={hintId} className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
