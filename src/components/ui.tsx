import { useEffect, useState } from "react";
import type {
  ReactNode,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { onToast } from "../lib/store";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  const variants: Record<string, string> = {
    primary:
      "btn-sheen bg-gradient-to-b from-accent-hover to-accent text-white shadow-[0_6px_18px_rgba(0,113,227,0.38),inset_0_1px_0_rgba(255,255,255,0.28)] hover:shadow-[0_8px_24px_rgba(0,113,227,0.5),inset_0_1px_0_rgba(255,255,255,0.28)] hover:brightness-110 focus:ring-accent/40",
    secondary:
      "glass-soft text-white hover:bg-white/[0.08] hover:border-white/[0.14] focus:ring-white/20",
    ghost: "bg-transparent text-white/70 hover:bg-white/[0.08] hover:text-white focus:ring-white/20",
    danger:
      "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/25 hover:border-red-500/40 focus:ring-red-500/30",
    success:
      "bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/25",
  };
  const sizes: Record<string, string> = {
    sm: "text-xs px-3 py-1.5 gap-1.5",
    md: "text-sm px-4 py-2 gap-2",
    lg: "text-[15px] px-6 py-3 gap-2",
  };
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center rounded-[10px] font-medium transition-all duration-200 active:scale-[0.97] focus:outline-none focus:ring-4 disabled:opacity-45 disabled:pointer-events-none disabled:active:scale-100",
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3 min-w-[220px]">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="go-range flex-1"
        style={{ background: `linear-gradient(to right, rgb(var(--accent)) ${p}%, rgba(255,255,255,0.12) ${p}%)` }}
      />
      <span className="w-12 text-right text-[12px] text-white/60 font-mono tabular-nums">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

export function RefreshButton({ onClick, loading, title }: { onClick: () => void; loading?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={loading}
      className="w-8 h-8 shrink-0 rounded-lg border border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/[0.14] text-white/55 hover:text-white flex items-center justify-center transition disabled:opacity-60"
    >
      <RotateCcw className={cx("w-3.5 h-3.5", loading && "animate-spin")} />
    </button>
  );
}

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cx(
        "rounded-xl2 glass transition-all duration-300",
        onClick && "cursor-pointer hover:border-white/[0.16] hover:shadow-lifted",
        className
      )}
    >
      {children}
    </div>
  );
}

export function StatCard({
  icon,
  label,
  value,
  sub,
  accent = "text-white/30",
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className="p-4 flex items-center gap-3.5 hover:border-white/[0.12]">
      <div
        className={cx(
          "w-10 h-10 rounded-[12px] bg-gradient-to-br from-white/[0.10] to-white/[0.03] border border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] flex items-center justify-center shrink-0",
          accent
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-white/40 font-medium uppercase tracking-wider">{label}</div>
        <div className="text-[17px] font-semibold text-white leading-tight truncate tracking-tight">{value}</div>
        {sub && <div className="text-[11px] text-white/35">{sub}</div>}
      </div>
    </Card>
  );
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10.5px] font-medium border border-white/[0.09] bg-white/[0.05] text-white/55",
        className
      )}
    >
      {children}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[13px] font-medium text-white/80">{label}</span>
        {hint && <span className="text-[11px] text-white/40">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}
export function TextInput({ className, ...rest }: InputProps) {
  return (
    <input
      className={cx(
        "w-full rounded-[10px] bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white placeholder-white/30",
        "hover:border-white/[0.16] focus:outline-none focus:border-accent/60 focus:ring-4 focus:ring-accent/15 transition",
        className
      )}
      {...rest}
    />
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}
export function SelectInput({ className, children, ...rest }: SelectProps) {
  return (
    <select
      className={cx(
        "w-full rounded-[10px] bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white appearance-none",
        "hover:border-white/[0.16] focus:outline-none focus:border-accent/60 transition cursor-pointer",
        className
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}
export function TextArea({ className, ...rest }: TextAreaProps) {
  return (
    <textarea
      className={cx(
        "w-full rounded-[10px] bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30",
        "hover:border-white/[0.16] focus:outline-none focus:border-accent/60 focus:ring-4 focus:ring-accent/15 transition resize-y min-h-[80px]",
        className
      )}
      {...rest}
    />
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative w-[46px] h-[28px] rounded-full transition-colors duration-200 shrink-0 focus:outline-none focus:ring-4 focus:ring-accent/20",
        checked
          ? "bg-gradient-to-b from-accent-hover to-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
          : "bg-white/[0.14] shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]",
        disabled && "opacity-40"
      )}
    >
      <span
        className={cx(
          "absolute top-[3px] left-[3px] w-[22px] h-[22px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.35)] transition-transform duration-200",
          checked && "translate-x-[18px]"
        )}
      />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("w-5 h-5 animate-spin text-accent", className)} />;
}

export function SpinnerBlock({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-white/50">
      <Spinner className="w-7 h-7" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
      <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center text-white/25">
        {icon}
      </div>
      <p className="text-[15px] font-medium text-white/70">{title}</p>
      {body && <p className="text-xs text-white/40 max-w-[300px]">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ProgressBar({ percent, className, color = "bg-gradient-to-r from-[#0a84ff] to-[#64d2ff]" }: { percent: number; className?: string; color?: string }) {
  return (
    <div className={cx("h-[6px] rounded-full bg-white/[0.08] overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]", className)}>
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-300 relative overflow-hidden shadow-[0_0_12px_rgba(10,132,255,0.5)]",
          color
        )}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-shimmer" />
      </div>
    </div>
  );
}

export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: "neutral" | "green" | "blue" | "amber" | "red"; className?: string; title?: string }) {
  const toneStyles: Record<string, string> = {
    neutral: "bg-white/[0.06] text-white/60 border-white/10",
    green: "bg-green-500/10 text-green-400 border-green-500/25",
    blue: "bg-accent/10 text-accent-soft border-accent/25",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/25",
    red: "bg-red-500/10 text-red-400 border-red-500/25",
  };
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border backdrop-blur-md", toneStyles[tone], className)}>
      {children}
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[6px]" onClick={onClose} />
      <div
        className={cx(
          "relative w-[95%] rounded-[22px] glass shadow-lifted max-h-[85vh] flex flex-col animate-[fadeUp_0.3s_ease]",
          wide ? "max-w-3xl" : "max-w-lg"
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <h2 className="text-[15px] font-semibold tracking-tight text-white">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/[0.05] hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center text-sm transition"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto bg-[#121317]/40 rounded-b-[22px]">{children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toastList = useToastList();
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
      {toastList.map((m, i) => (
        <div
          key={i}
          className="glass-soft px-4 py-2.5 rounded-2xl text-sm text-white/85 animate-[fadeUp_0.3s_ease] flex items-center gap-2.5"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(10,132,255,0.9)] shrink-0" />
          {m}
        </div>
      ))}
    </div>
  );
}

function useToastList() {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    return onToast((m) => {
      setList((l) => [...l, m]);
      setTimeout(() => setList((l) => l.filter((x) => x !== m)), 2600);
    });
  }, []);
  return list;
}